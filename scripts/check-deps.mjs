#!/usr/bin/env node
// 架构依赖方向检查（依据 docs/design/architecture.md 第 12 节）：
// 1. 工作区包间 DAG，禁止反向依赖；
// 2. packages/server 内 DDD 分层，domain 不依赖框架或 IO，application 不依赖 HTTP 框架；
// 3. apps/web 内 FSD 分层（routes → widgets → features → entities → shared）。
import fs from 'node:fs'
import path from 'node:path'

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

// web FSD 层级顺序：只允许高层指向低层或同层
const WEB_FSD_RANK = {
  shared: 0,
  entities: 1,
  features: 2,
  widgets: 3,
  routes: 4,
}

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
    for (const file of walk(srcDir)) {
      const rel = path.relative(ROOT, file)
      const content = fs.readFileSync(file, 'utf8')
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

        // 4. apps/web FSD 分层检查
        if (pkgName === '@akasha/web' && spec.startsWith('.')) {
          const fromLayer = path.relative(srcDir, file).split(path.sep)[0]
          if (fromLayer in WEB_FSD_RANK) {
            const target = path.resolve(path.dirname(file), spec)
            const targetRel = path.relative(srcDir, target)
            if (!targetRel.startsWith('..')) {
              const targetLayer = targetRel.split(path.sep)[0]
              if (
                targetLayer in WEB_FSD_RANK &&
                WEB_FSD_RANK[targetLayer] > WEB_FSD_RANK[fromLayer]
              ) {
                violations.push(
                  `${rel}: 违反外壳 FSD 分层 ${fromLayer} → ${targetLayer} ("${spec}")`,
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
