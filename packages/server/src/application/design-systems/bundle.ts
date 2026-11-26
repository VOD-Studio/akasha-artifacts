import path from 'node:path/posix'
import type { DesignSystemDraft } from '@akasha/protocol'
import { build, type Loader, type Plugin } from 'esbuild'
import { DomainError } from '../../domain/errors.js'

const sourceLoaders = new Map<string, Loader>([
  ['.tsx', 'tsx'],
  ['.ts', 'ts'],
  ['.jsx', 'jsx'],
  ['.js', 'js'],
  ['.json', 'json'],
  ['.css', 'css'],
])
const runtimeModules: Record<string, true> = { react: true, 'react/jsx-runtime': true }

/** 只在内存命名空间解析导入；无论缺文件、未知包或绝对路径，均无宿主解析回退。 */
export async function bundleSelectedComponents(
  draft: Pick<DesignSystemDraft, 'files' | 'components'>,
) {
  const selected = new Map(draft.files.map((file) => [file.path, file]))
  const entries = draft.components.map(
    ({ path: entryPath, exportName }) =>
      `export {${exportName} as component} from ${JSON.stringify(`selected:${entryPath}`)};`,
  )

  const plugin: Plugin = {
    name: 'selected-files-only',
    setup(ctx) {
      ctx.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return { namespace: 'registry', path: args.path }
        if (args.namespace === 'registry')
          return { namespace: 'selected', path: args.path.slice('selected:'.length) }
        if (args.kind === 'import-statement' && Object.hasOwn(runtimeModules, args.path))
          return { namespace: 'runtime', path: args.path }
        const denied = { errors: [{ text: `未授权的依赖 ${args.path}（${args.importer}）` }] }
        if (!['import-statement', 'import-rule', 'url-token'].includes(args.kind)) return denied
        if (
          (!args.path.startsWith('./') &&
            !args.path.startsWith('../') &&
            args.kind !== 'url-token' &&
            args.kind !== 'import-rule') ||
          /[\\:#?%]/.test(args.path) ||
          args.path.startsWith('/')
        )
          return denied
        const relative = path.join(path.dirname(args.importer), args.path)
        const candidates = [relative]
        if (!path.extname(relative)) {
          for (const suffix of sourceLoaders.keys()) candidates.push(relative + suffix)
          for (const suffix of sourceLoaders.keys()) candidates.push(`${relative}/index${suffix}`)
        }
        const found = candidates.find((candidate) => selected.has(candidate))
        if (!found) return denied
        return { namespace: 'selected', path: found }
      })
      ctx.onLoad({ filter: /.*/, namespace: 'registry' }, ({ path: name }) => ({
        contents: entries[Number(name)],
        loader: 'js',
      }))
      // React 由隔离沙盒提供，不让来源代码从服务端的 node_modules 寻址。
      ctx.onLoad({ filter: /.*/, namespace: 'runtime' }, ({ path: name }) => ({
        contents: `module.exports = globalThis.__AKASHA_MODULES__[${JSON.stringify(name)}];`,
        loader: 'js',
      }))
      ctx.onLoad({ filter: /.*/, namespace: 'selected' }, ({ path: name }) => {
        const file = selected.get(name)
        if (file?.kind === 'source') {
          const loader = sourceLoaders.get(path.extname(name).toLowerCase())
          if (loader) return { contents: file.content, loader }
        }
        if (file?.kind === 'font' || file?.kind === 'logo')
          return { contents: Buffer.from(file.content, 'base64'), loader: 'dataurl' }
        return { errors: [{ text: `不支持的来源模块 ${name}` }] }
      })
    },
  }
  try {
    const result = await build({
      entryPoints: entries.map((_, i) => ({ in: String(i), out: `entry-${i}` })),
      bundle: true,
      write: false,
      outdir: 'out',
      format: 'iife',
      globalName: 'AkashaReviewed',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      tsconfigRaw: {},
      logLevel: 'silent',
      plugins: [plugin],
      logOverride: {
        'unsupported-dynamic-import': 'error',
        'unsupported-require-call': 'error',
        'ignored-dynamic-import': 'error',
        'ignored-require': 'error',
        'empty-glob': 'error',
      },
    })
    if (result.warnings.length) throw new Error(result.warnings.map((item) => item.text).join('; '))
    const output = new Map(result.outputFiles.map((file) => [path.basename(file.path), file]))
    return entries.map((_, i) => {
      const js = output.get(`entry-${i}.js`)
      if (!js) throw new Error('没有组件输出')
      const css = output.get(`entry-${i}.css`)?.text ?? ''
      return `(()=>{\n${js.text}\nreturn {component: AkashaReviewed.component, css:${JSON.stringify(css)}};})()`
    })
  } catch (error) {
    throw new DomainError('BAD_REQUEST', error instanceof Error ? error.message : '组件构建失败')
  }
}
