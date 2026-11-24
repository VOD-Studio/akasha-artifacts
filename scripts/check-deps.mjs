#!/usr/bin/env node
// 架构依赖方向检查（依据 docs/design/architecture.md 第 12 节）：
// 1. 工作区包间 DAG，禁止反向依赖；
// 2. packages/server 内 DDD 分层，domain 不依赖框架或 IO，application 不依赖 HTTP 框架；
// 3. apps/web 源码的 FSD 分层与切片边界；routes、shared 不要求切片入口。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()

// 每个工作区包允许依赖的内部工作区包集合
const ALLOWED_PACKAGE_DEPS = {
  '@akasha/protocol': new Set(),
  '@akasha/ui': new Set(),
  '@akasha/jsx-source': new Set(['@akasha/protocol']),
  '@akasha/kit': new Set(['@akasha/protocol']),
  '@akasha/mcp': new Set(['@akasha/protocol']),
  '@akasha/hooks': new Set(['@akasha/protocol']),
  '@akasha/skills': new Set(['@akasha/protocol']),
  '@akasha/server': new Set(['@akasha/protocol', '@akasha/jsx-source', '@akasha/kit']),
  '@akasha/web': new Set(['@akasha/protocol', '@akasha/ui']),
  '@akasha/sandbox': new Set(['@akasha/protocol', '@akasha/jsx-source', '@akasha/kit']),
  'akasha-artifacts': new Set([
    '@akasha/protocol',
    '@akasha/server',
    '@akasha/mcp',
    '@akasha/hooks',
    '@akasha/jsx-source',
    '@akasha/kit',
    '@akasha/ui',
    '@akasha/skills',
    '@akasha/web',
    '@akasha/sandbox',
  ]),
}

const WORKSPACE_NAMES = new Set(Object.keys(ALLOWED_PACKAGE_DEPS))

// server DDD 分层允许向内依赖的方向
const SERVER_LAYER_ALLOWED = {
  domain: new Set(['domain']),
  application: new Set(['domain', 'application']),
  infrastructure: new Set(['domain', 'infrastructure']),
  interfaces: new Set(['domain', 'application', 'interfaces']),
  app: new Set(['domain', 'application', 'infrastructure', 'interfaces', 'app']),
  entry: new Set(['domain', 'application', 'infrastructure', 'interfaces', 'app', 'entry']),
}

// domain 层禁止直接引入的外部框架或 IO 模块
const DOMAIN_FORBIDDEN_IMPORTS = [
  /^hono(?:\/|$)/,
  /^node:(?:fs|http|https|net|sqlite|child_process)/,
]
// application 层禁止引入 HTTP 框架
const APPLICATION_FORBIDDEN_IMPORTS = [/^hono(?:\/|$)/]

// 数值越大越靠近页面装配；同层切片另有隔离规则。
const WEB_FSD_RANK = {
  shared: 0,
  entities: 1,
  features: 2,
  widgets: 3,
  routes: 4,
}

const WEB_FSD_SLICE_LAYERS = new Set(['entities', 'features', 'widgets'])

const IMPORT_RE =
  /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function extractSpecifiers(content) {
  // 去除块注释与行注释，避免注释里的示例 import 误报
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const specs = []
  for (const m of stripped.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2]
    if (spec) specs.push(spec)
  }
  return specs
}

function packageRootName(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec
  }
  return spec.split('/')[0]
}

function webLayerPath(srcDir, file) {
  const parts = path.relative(srcDir, file).split(path.sep)
  return Object.hasOwn(WEB_FSD_RANK, parts[0]) ? parts : []
}

function checkWebSliceEntries(srcDir, violations) {
  for (const layer of WEB_FSD_SLICE_LAYERS) {
    const dir = path.join(srcDir, layer)
    if (!fs.existsSync(dir)) continue
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const index = path.join(dir, entry.name, 'index.ts')
      if (!ts.sys.fileExists(index) && walk(path.dirname(index)).length > 0) {
        violations.push(`${path.relative(ROOT, index)}: 外壳 FSD 切片缺少根入口，请创建 index.ts`)
      }
    }
  }
}

function createWebFsdResolver(pkgDir, violations) {
  const configPath = path.join(pkgDir, 'tsconfig.json')
  let options = { moduleResolution: ts.ModuleResolutionKind.Bundler }
  if (ts.sys.fileExists(configPath)) {
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
    if (error) {
      violations.push(
        `${path.relative(ROOT, configPath)}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`,
      )
    } else {
      options = ts.parseJsonConfigFileContent(config, ts.sys, pkgDir, undefined, configPath).options
    }
  }

  const cache = ts.createModuleResolutionCache(pkgDir, (file) => file, options)
  return (spec, file, mode) =>
    ts.resolveModuleName(spec, file, options, ts.sys, cache, undefined, mode).resolvedModule
}

function checkWebFsd(srcDir, file, rel, content, resolve, violations) {
  const [fromLayer, fromSlice, ...fromRest] = webLayerPath(srcDir, file)
  const inSlice = WEB_FSD_SLICE_LAYERS.has(fromLayer) && fromRest.length > 0

  const checkSpecifier = (spec, mode = ts.ModuleKind.ESNext) => {
    const relative = /^\.{1,2}(?:\/|$)/.test(spec)
    const resolved = resolve(spec, file, mode)
    if (resolved?.isExternalLibraryImport) return
    // 尚未存在的相对路径也要检查方向，不能靠省略目标文件掩盖反向依赖。
    const target =
      resolved?.resolvedFileName ?? (relative && path.resolve(path.dirname(file), spec))
    if (!target) return
    const [toLayer, toSlice, ...toRest] = webLayerPath(srcDir, target)
    if (!toLayer) return

    if (fromLayer && WEB_FSD_RANK[toLayer] > WEB_FSD_RANK[fromLayer]) {
      violations.push(`${rel}: 违反外壳 FSD 分层 ${fromLayer} → ${toLayer} ("${spec}")`)
      return
    }
    if (!WEB_FSD_SLICE_LAYERS.has(toLayer) || !toSlice) return
    // 层下的单文件不是切片；未解析的根目录导入仍可用现有目录识别。
    if (toRest.length === 0 && !ts.sys.directoryExists(target)) return

    const slice = `${toLayer}/${toSlice}`
    const index = `${slice}/index.ts`
    const usesIndex =
      toRest.length === 0 ||
      (toRest.length === 1 &&
        (toRest[0] === 'index.ts' || (!resolved && /^index(?:\.js)?$/.test(toRest[0]))))

    // 横向依赖不能用公开入口修复，优先指出切片边界。
    if (inSlice && fromLayer === toLayer) {
      if (fromSlice !== toSlice) {
        violations.push(
          `${rel}: 禁止外壳 FSD 同层跨切片依赖 ${fromLayer}/${fromSlice} → ${slice} ("${spec}")`,
        )
      } else if (usesIndex) {
        violations.push(`${rel}: 外壳 FSD 切片内部禁止导入自身根入口 ${index} ("${spec}")`)
      } else if (!relative) {
        violations.push(`${rel}: 外壳 FSD 切片内部请使用相对路径导入实现 ("${spec}")`)
      }
    } else if (!usesIndex) {
      violations.push(`${rel}: 违反外壳 FSD 切片入口，请从 ${index} 导入 ("${spec}")`)
    }
  }

  // AST 保留类型导入、命名空间重导出和带字面量的运行时导入，不扫描字符串或注释。
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        checkSpecifier(node.moduleSpecifier.text)
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteral(node.argument.literal)) checkSpecifier(node.argument.literal.text)
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteral(node.expression)) {
      checkSpecifier(node.expression.text, ts.ModuleKind.CommonJS)
    } else if (ts.isCallExpression(node)) {
      const {
        expression,
        arguments: [argument],
      } = node
      if (argument && ts.isStringLiteralLike(argument)) {
        if (expression.kind === ts.SyntaxKind.ImportKeyword) checkSpecifier(argument.text)
        if (ts.isIdentifier(expression) && expression.text === 'require') {
          checkSpecifier(argument.text, ts.ModuleKind.CommonJS)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(ts.createSourceFile(file, content, ts.ScriptTarget.Latest))
}

const violations = []

for (const group of ['packages', 'apps']) {
  const groupDir = path.join(ROOT, group)
  if (!fs.existsSync(groupDir)) continue
  for (const entry of fs.readdirSync(groupDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const pkgDir = path.join(groupDir, entry.name)
    const pkgJsonPath = path.join(pkgDir, 'package.json')
    if (!fs.existsSync(pkgJsonPath)) continue
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    const pkgName = pkgJson.name
    const allowed = ALLOWED_PACKAGE_DEPS[pkgName]
    if (!allowed) {
      violations.push(
        `${path.relative(ROOT, pkgJsonPath)}: 未在依赖规则中登记的工作区包 "${pkgName}"`,
      )
      continue
    }

    // 1. 检查 package.json 声明的内部依赖
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(pkgJson[field] ?? {})) {
        if (WORKSPACE_NAMES.has(dep) && dep !== pkgName && !allowed.has(dep)) {
          violations.push(`${path.relative(ROOT, pkgJsonPath)}: 禁止反向依赖 ${pkgName} → ${dep}`)
        }
      }
    }

    // 2. 扫描源码中的 import 语句
    const srcDir = path.join(pkgDir, 'src')
    const resolveWebModule =
      pkgName === '@akasha/web' ? createWebFsdResolver(pkgDir, violations) : undefined
    if (resolveWebModule) checkWebSliceEntries(srcDir, violations)
    for (const file of walk(srcDir)) {
      const rel = path.relative(ROOT, file)
      const content = fs.readFileSync(file, 'utf8')
      if (resolveWebModule) checkWebFsd(srcDir, file, rel, content, resolveWebModule, violations)
      const specs = extractSpecifiers(content)

      for (const spec of specs) {
        if (!spec.startsWith('.')) {
          const depPkg = packageRootName(spec)
          if (WORKSPACE_NAMES.has(depPkg) && depPkg !== pkgName && !allowed.has(depPkg)) {
            violations.push(`${rel}: 禁止跨包依赖 ${pkgName} → ${depPkg}`)
          }
        }

        // 3. packages/server DDD 分层检查
        if (pkgName === '@akasha/server') {
          const fromRel = path.relative(srcDir, file).split(path.sep)
          const fromLayer = fromRel[0]
          if (fromLayer === 'domain') {
            for (const re of DOMAIN_FORBIDDEN_IMPORTS) {
              if (re.test(spec)) {
                violations.push(`${rel}: domain 层禁止引入外部框架或 IO 模块 "${spec}"`)
              }
            }
          }
          if (fromLayer === 'application') {
            for (const re of APPLICATION_FORBIDDEN_IMPORTS) {
              if (re.test(spec)) {
                violations.push(`${rel}: application 层禁止引入 HTTP 框架 "${spec}"`)
              }
            }
          }
          if (spec.startsWith('.') && SERVER_LAYER_ALLOWED[fromLayer]) {
            const target = path.resolve(path.dirname(file), spec)
            const targetRel = path.relative(srcDir, target)
            if (!targetRel.startsWith('..')) {
              const targetLayer = targetRel.split(path.sep)[0]
              if (
                SERVER_LAYER_ALLOWED[targetLayer] &&
                !SERVER_LAYER_ALLOWED[fromLayer].has(targetLayer)
              ) {
                violations.push(
                  `${rel}: 违反服务端 DDD 分层 ${fromLayer} → ${targetLayer} ("${spec}")`,
                )
              }
            }
          }
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('依赖方向检查失败：')
  for (const v of violations) {
    console.error(`  - ${v}`)
  }
  process.exit(1)
}

console.log('依赖方向检查通过')
