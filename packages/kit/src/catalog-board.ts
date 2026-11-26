import {
  catalogReferenceHeader,
  type DesignSystemReference,
  type DesignSystemSnapshot,
} from '@akasha/protocol'
import {
  type CatalogBoardSource,
  type CatalogRegion,
  catalogRegions,
  componentFence,
} from './catalog-regions.js'
import { renderFixedSelection } from './design-system.js'

interface FixedSelection {
  id: string
  version: number
  title?: string
  snapshot: DesignSystemSnapshot
  index: number | null
}

// 每个来源拥有独立的样式树，但组件仍在沙盒的同一 React 根中接收事件与更新。
const isolatedSystem = `function IsolatedSystem({Board}) {
  const [root, setRoot] = React.useState(null);
  const attach = React.useCallback(host => {
    if (host) setRoot(host.shadowRoot ?? host.attachShadow({mode:'open'}));
  }, []);
  return React.createElement('section', {ref:attach}, root && createPortal(React.createElement(Board), root));
}`

/** 从给定固定版本生成独立设计；空选择只保留标题，不携带任何系统或运行时来源请求。 */
export function composeCatalogBoard(
  title: string,
  systems: readonly FixedSelection[],
): CatalogBoardSource {
  const references: DesignSystemReference[] = []
  const regions: CatalogRegion[] = []
  let body = "import * as React from 'react';\n"
  if (systems.length) {
    body += "import { createPortal } from 'react-dom';\nconst boards = [\n"
    for (const [system, entry] of systems.entries()) {
      const { id, version, snapshot, index } = entry
      const fixed = renderFixedSelection(snapshot, { id, version }, index, {
        system,
        title: entry.title ?? id,
      })
      const { reference } = fixed
      references.push(reference)
      if (system) body += ',\n'
      const base = body.length
      for (const [i, [start, end]] of fixed.compiledRanges.entries()) {
        regions.push({
          kind: 'component',
          reference,
          index: i,
          start: base + start,
          end: base + end,
          close: `\n${componentFence(system, i, 'end')}`,
        })
      }
      regions.push(
        { kind: 'model', reference, start: base + fixed.modelStart, end: base + fixed.modelEnd },
        { kind: 'reference', start: base + fixed.referenceStart, end: base + fixed.referenceEnd },
      )
      body += fixed.source
    }
    body += `\n];\n${isolatedSystem}\n`
  }
  body +=
    "export default function CatalogBoard() {\n  return React.createElement('main', null, React.createElement('h1', null, "
  const start = body.length
  body += JSON.stringify(title)
  regions.push({ kind: 'title', start, end: body.length })
  body += systems.length
    ? '),\n    ...boards.map((Board, i) => React.createElement(IsolatedSystem, {key:i, Board})));\n}\n'
    : '));\n}\n'
  const header = catalogReferenceHeader(references)
  for (const region of regions) {
    region.start += header.length + 1
    region.end += header.length + 1
  }
  regions.unshift({ kind: 'reference', start: 0, end: header.length })
  return { source: `${header}\n${body}`, references, [catalogRegions]: regions }
}
