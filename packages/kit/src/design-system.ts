import type { DesignSystemDraft, DesignSystemSnapshot } from '@akasha/protocol'
import { DesignSystemSnapshotSchema } from '@akasha/protocol'
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

/** 返回沙盒 React Artifact 源码；组件表来自静态编译产物，不从名称仿制组件。 */
export function designSystemPreviewSource(
  draft: DesignSystemDraft,
  sourceVersion: string,
  modules: readonly string[],
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
    origin: draft.origin.label,
    sourceVersion,
    components: draft.components,
    logos: assets.filter((asset) => asset.kind === 'logo').map(({ path, url }) => ({ path, url })),
    guidelines: draft.files.filter((f) => f.kind === 'guidelines').map((f) => f.content),
    css: fontRules,
  }
  let previewSource = `import * as React from 'react';\nconst reviewed = [\n`
  const compiledRanges: [number, number][] = []
  for (const module of modules) {
    compiledRanges.push([previewSource.length, previewSource.length + module.length])
    previewSource += `${module},\n`
  }
  previewSource += `];\nconst model = ${JSON.stringify(model)};
export default function DesignSystemBoard() {
  const h = React.createElement;
  const style = {display:'grid', alignContent:'start', justifyItems:'start', gap:model.spacing, padding:model.spacing, color:model.color, fontFamily:model.fontFamily || undefined};
  return h('main', {style, 'data-ak-source-version':model.sourceVersion},
    model.css && h('style', null, model.css),
    ...reviewed.map(({css},i) => css ? h('style',{key:'css'+i},css) : null),
    ...model.logos.map(item => h('img', {key:item.path, src:item.url, alt:item.path, style:{maxWidth:'100%', maxHeight:96, objectFit:'contain'}})),
    ...(model.components.length === 0 ? [h('h1',{key:'title'},model.origin),h('p',{key:'instructions'},model.instructions), ...model.guidelines.map((text,i) => h('p',{key:i,style:{whiteSpace:'pre-wrap'}},text))] : []),
    ...model.components.map((item,i) => h('div',{key:i, 'data-ak-component':item.path+'#'+item.exportName},h(reviewed[i].component,item.props)))
  );
}\n`
  return { previewSource, compiledRanges }
}
