import type { ComponentType } from 'react'
import { transform } from 'sucrase'
import { installSandboxGlobals, isWhitelistedModule } from './modules'

export class ArtifactCompileError extends Error {
  readonly phase = 'compile' as const
  readonly loc?: string

  constructor(message: string, loc?: string) {
    super(message)
    this.name = 'ArtifactCompileError'
    this.loc = loc
  }
}

const STATIC_IMPORT_RE = /(?:^|;)[ \t]*import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"][ \t]*;?/gm
const REEXPORT_FROM_RE = /(?:^|;)[ \t]*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/g

function lineNumberAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

function parseNamedBindings(raw: string): Array<{ imported: string; local: string }> {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\w+)\s+as\s+(\w+)$/.exec(part)
      if (m?.[1] && m[2]) {
        return { imported: m[1], local: m[2] }
      }
      return { imported: part, local: part }
    })
}

// 将白名单静态 import 改写为对预打包 globalThis.__AKASHA_MODULES__ 的同步读取；越界依赖或动态 import 一律在编译阶段拦截。
export function rewriteWhitelistedImports(code: string): string {
  const dynamicMatch = DYNAMIC_IMPORT_RE.exec(code)
  DYNAMIC_IMPORT_RE.lastIndex = 0
  if (dynamicMatch) {
    const line = lineNumberAt(code, dynamicMatch.index)
    throw new ArtifactCompileError(
      '沙盒禁止使用动态 import()，请使用白名单静态 import',
      `${line}:1`,
    )
  }

  const reexportMatch = REEXPORT_FROM_RE.exec(code)
  REEXPORT_FROM_RE.lastIndex = 0
  if (reexportMatch) {
    const line = lineNumberAt(code, reexportMatch.index)
    throw new ArtifactCompileError(
      `沙盒禁止从外部模块 "${reexportMatch[1] ?? ''}" 直接 re-export`,
      `${line}:1`,
    )
  }

  let modIndex = 0
  return code.replace(
    STATIC_IMPORT_RE,
    (full, rawClause: string | undefined, spec: string, offset: number) => {
      const prefix = full.trimStart().startsWith(';') ? ';\n' : ''
      if (!isWhitelistedModule(spec)) {
        const line = lineNumberAt(code, offset)
        throw new ArtifactCompileError(`依赖 "${spec}" 不在沙盒预置白名单内`, `${line}:1`)
      }

      const clause = rawClause?.trim()
      if (!clause) {
        return `${prefix}/* whitelisted side-effect import: ${spec} */`
      }

      const modVar = `__ak_mod_${modIndex++}`
      const lines = [
        `${prefix}const ${modVar} = globalThis.__AKASHA_MODULES__[${JSON.stringify(spec)}];`,
      ]

      // import * as Foo from 'pkg'
      const nsMatch = /^\*\s+as\s+(\w+)$/.exec(clause)
      if (nsMatch?.[1]) {
        lines.push(`const ${nsMatch[1]} = ${modVar};`)
        return lines.join('\n')
      }

      // import Default, * as Ns from 'pkg'
      const defNsMatch = /^(\w+)\s*,\s*\*\s+as\s+(\w+)$/.exec(clause)
      if (defNsMatch?.[1] && defNsMatch[2]) {
        lines.push(`const ${defNsMatch[1]} = ${modVar}.default ?? ${modVar};`)
        lines.push(`const ${defNsMatch[2]} = ${modVar};`)
        return lines.join('\n')
      }

      // import Default, { a, b as c } from 'pkg'
      const defNamedMatch = /^(\w+)\s*,\s*\{([\s\S]*)\}$/.exec(clause)
      if (defNamedMatch?.[1] && defNamedMatch[2] !== undefined) {
        lines.push(`const ${defNamedMatch[1]} = ${modVar}.default ?? ${modVar};`)
        for (const { imported, local } of parseNamedBindings(defNamedMatch[2])) {
          lines.push(`const ${local} = ${modVar}[${JSON.stringify(imported)}];`)
        }
        return lines.join('\n')
      }

      // import { a, b as c } from 'pkg'
      const namedMatch = /^\{([\s\S]*)\}$/.exec(clause)
      if (namedMatch?.[1] !== undefined) {
        for (const { imported, local } of parseNamedBindings(namedMatch[1])) {
          lines.push(`const ${local} = ${modVar}[${JSON.stringify(imported)}];`)
        }
        return lines.join('\n')
      }

      // import Default from 'pkg'
      if (/^\w+$/.test(clause)) {
        lines.push(`const ${clause} = ${modVar}.default ?? ${modVar};`)
        return lines.join('\n')
      }

      const line = lineNumberAt(code, offset)
      throw new ArtifactCompileError(`无法解析的 import 语法："${clause}"`, `${line}:1`)
    },
  )
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node)
}

async function importCompiledModule(code: string): Promise<Record<string, unknown>> {
  if (isNodeRuntime()) {
    // Node/Vitest 测试环境不支持 blob: ESM scheme，改用标准 data: ESM URL 加载，全程不使用 eval
    const encoded = Buffer.from(code, 'utf8').toString('base64')
    return (await import(/* @vite-ignore */ `data:text/javascript;base64,${encoded}`)) as Record<
      string,
      unknown
    >
  }

  // 浏览器沙盒环境使用 blob: ESM URL，兼容严格 CSP（script-src 'self' blob:，无 unsafe-eval）
  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function compileReactArtifact(source: string): Promise<ComponentType> {
  installSandboxGlobals()

  let jsCode: string
  try {
    const transformed = transform(source, {
      transforms: ['typescript', 'jsx'],
      jsxRuntime: 'automatic',
      production: true,
      filePath: 'Artifact.tsx',
    })
    jsCode = transformed.code
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const locObj = (err as { loc?: { line?: number; column?: number } })?.loc
    const loc =
      locObj?.line !== undefined ? `${locObj.line}:${(locObj.column ?? 0) + 1}` : undefined
    throw new ArtifactCompileError(msg, loc)
  }

  const rewritten = rewriteWhitelistedImports(jsCode)
  const mod = await importCompiledModule(rewritten)
  const exported = mod.default
  if (typeof exported !== 'function') {
    throw new ArtifactCompileError(
      'React Artifact 必须使用 export default 导出一个有效的函数或类组件',
    )
  }
  return exported as ComponentType
}
