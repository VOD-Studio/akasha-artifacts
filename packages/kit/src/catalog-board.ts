import {
  catalogReferenceHeader,
  type DesignSystemReference,
  type DesignSystemSnapshot,
} from '@akasha/protocol'
import { renderFixedSelection } from './design-system.js'

interface FixedSelection {
  id: string
  version: number
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
): { source: string; references: DesignSystemReference[] } {
  const references: DesignSystemReference[] = []
  const boards: string[] = []
  for (const { id, version, snapshot, index } of systems) {
    const { source, reference } = renderFixedSelection(snapshot, { id, version }, index, 'closure')
    references.push(reference)
    boards.push(source)
  }
  const header = `${catalogReferenceHeader(references)}\nimport * as React from 'react';\n`
  const heading = `React.createElement('h1', null, ${JSON.stringify(title)})`
  if (!boards.length) {
    return {
      source: `${header}export default function CatalogBoard() {\n  return React.createElement('main', null, ${heading});\n}\n`,
      references,
    }
  }
  const source = `${header}import { createPortal } from 'react-dom';
const boards = [\n${boards.join(',\n')}\n];
${isolatedSystem}
export default function CatalogBoard() {
  return React.createElement('main', null, ${heading},
    ...boards.map((Board, i) => React.createElement(IsolatedSystem, {key:i, Board})));
}\n`
  return { source, references }
}
