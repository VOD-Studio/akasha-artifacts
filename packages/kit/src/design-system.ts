import type {
  DesignSystemDraft,
  DesignSystemReference,
  DesignSystemSnapshot,
} from '@akasha/protocol'
import { DesignSystemSnapshotSchema, designSystemReferenceHeader } from '@akasha/protocol'
import { componentFence } from './catalog-regions.js'
import type { KitParseResult } from './registry.js'

const mimeTypes: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
}

/** 系统快照只能由专用的审阅流程写入；沙盒不解析来源路径、不运行构建。 */
export function parseDesignSystem(source: string): KitParseResult<DesignSystemSnapshot> {
  try {
    return { ok: true, data: DesignSystemSnapshotSchema.parse(JSON.parse(source)) }
  } catch {
    return { ok: false, error: '无效的设计系统快照' }
  }
}

type BoardFormat = 'standalone' | { system: number; title: string }

function renderReviewedSource(
  draft: DesignSystemDraft,
  sourceVersion: string,
  modules: readonly string[],
  reference: Pick<DesignSystemReference, 'id' | 'version'> | undefined,
  format: BoardFormat,
) {
  const assets = draft.files
    .filter((file) => file.kind === 'font' || file.kind === 'logo')
    .map((file) => ({
      path: file.path,
      kind: file.kind,
      url: `data:${mimeTypes[file.path.split('.').pop()?.toLowerCase() ?? '']};base64,${file.content}`,
    }))
  const fontRules = assets
    .filter((file) => file.kind === 'font')
    .map((file, i) => {
      const family =
        i === 0 && draft.guidance.fontFamily
          ? draft.guidance.fontFamily
          : file.path
              .split('/')
              .pop()
              ?.replace(/\.[^.]*$/, '')
      return `@font-face{font-family:${JSON.stringify(family)};src:url("${file.url}")}`
    })
    .join('\n')
  const model = {
    ...draft.guidance,
    origin: format === 'standalone' ? draft.origin.label : format.title,
    sourceVersion,
    components: draft.components,
    logos: assets.filter((asset) => asset.kind === 'logo').map(({ path, url }) => ({ path, url })),
    guidelines: draft.files.filter((f) => f.kind === 'guidelines').map((f) => f.content),
    css: fontRules,
  }
  // 独立源码也用于鉴别既有生成稿，换行和声明保持稳定；目录只替换受信的外层入口。
  let previewSource =
    (format === 'standalone' ? "import * as React from 'react';\n" : '(() => {\n') +
    'const reviewed = [\n'
  const compiledRanges: [number, number][] = []
  for (const [index, module] of modules.entries()) {
    if (format !== 'standalone')
      previewSource += `${componentFence(format.system, index, 'begin')}\n`
    compiledRanges.push([previewSource.length, previewSource.length + module.length])
    previewSource += module
    if (format !== 'standalone') previewSource += `\n${componentFence(format.system, index, 'end')}`
    previewSource += ',\n'
  }
  previewSource += '];\nconst model = '
  const modelStart = previewSource.length
  previewSource += JSON.stringify(model)
  const modelEnd = previewSource.length
  previewSource += ';\nconst reference = '
  const referenceStart = previewSource.length
  previewSource += JSON.stringify(reference ?? null)
  const referenceEnd = previewSource.length
  previewSource += `;
${format === 'standalone' ? 'export default' : 'return'} function DesignSystemBoard() {
  const h = React.createElement;
  const style = {display:'grid', alignContent:'start', justifyItems:'start', gap:model.spacing, padding:model.spacing, color:model.color, fontFamily:model.fontFamily || undefined};
  return h('main', {style, 'data-ak-system':reference?.id, 'data-ak-system-version':reference?.version, 'data-ak-source-version':model.sourceVersion},
    model.css && h('style', null, model.css),
    ...reviewed.map(({css},i) => css ? h('style',{key:'css'+i},css) : null),
    ...model.logos.map(item => h('img', {key:item.path, src:item.url, alt:item.path, style:{maxWidth:'100%', maxHeight:96, objectFit:'contain'}})),
    ...(model.components.length === 0 ? [h('h1',{key:'title'},model.origin),h('p',{key:'instructions'},model.instructions), ...model.guidelines.map((text,i) => h('p',{key:i,style:{whiteSpace:'pre-wrap'}},text))] : []),
    ...model.components.map((item,i) => h('div',{key:i, 'data-ak-component':item.path+'#'+item.exportName},h(reviewed[i].component,item.props)))
  );
}\n`
  if (format !== 'standalone') previewSource += '})()'
  return { previewSource, compiledRanges, modelStart, modelEnd, referenceStart, referenceEnd }
}

/** 返回沙盒 React Artifact 源码；组件表来自静态编译产物，不从名称仿制组件。 */
export function designSystemPreviewSource(
  draft: DesignSystemDraft,
  sourceVersion: string,
  modules: readonly string[],
  reference?: { id: string; version: number },
) {
  const { previewSource, compiledRanges } = renderReviewedSource(
    draft,
    sourceVersion,
    modules,
    reference,
    'standalone',
  )
  return { previewSource, compiledRanges }
}

/** 只复制固定快照注明的闭包区间；不解析、改写或重新编译用户模块。 */
export function renderFixedSelection(
  snapshot: DesignSystemSnapshot,
  identity: Pick<DesignSystemReference, 'id' | 'version'>,
  index: number | null,
  format: BoardFormat,
) {
  if (index !== null && (!Number.isInteger(index) || !snapshot.draft.components[index]))
    throw new RangeError('该固定版本不包含所选组件')
  const ranges =
    index === null ? snapshot.compiledRanges : snapshot.compiledRanges.slice(index, index + 1)
  const modules = ranges.map(([start, end]) => snapshot.previewSource.slice(start, end))
  const selected =
    index === null ? snapshot.draft.components : snapshot.draft.components.slice(index, index + 1)
  const reference: DesignSystemReference = {
    ...identity,
    sourceVersion: snapshot.sourceVersion,
    components: selected.map(({ path, exportName }) => ({ path, exportName })),
  }
  const { previewSource: source, ...offsets } = renderReviewedSource(
    { ...snapshot.draft, components: selected },
    snapshot.sourceVersion,
    modules,
    identity,
    format,
  )
  return { source, reference, ...offsets }
}

/** 更换的只有可信入口；固定版本内的组件代码、样式和品牌资源不变。 */
export function generateDesignSystemBoard(
  snapshot: DesignSystemSnapshot,
  identity: { id: string; version: number },
  index: number | null,
): string {
  const { source, reference } = renderFixedSelection(snapshot, identity, index, 'standalone')
  return `${designSystemReferenceHeader(reference)}\n${source}`
}
