import { type DefaultTreeAdapterMap, parse, parseFragment } from 'parse5'
import {
  applyInsertions,
  type BlockEntry,
  type InjectedLocationEntry,
  type InjectLocationsResult,
  type StringInsertion,
} from './types.js'

interface Parse5Attr {
  name: string
  value: string
}

interface Parse5Location {
  startLine: number
  startCol: number
  startOffset: number
  endOffset: number
  startTag?: {
    startLine: number
    startCol: number
    startOffset: number
    endOffset: number
  }
}

interface Parse5Node {
  nodeName: string
  tagName?: string
  attrs?: Parse5Attr[]
  childNodes?: Parse5Node[]
  content?: Parse5Node
  sourceCodeLocation?: Parse5Location | null
}

/** 不注入 `data-ak-loc` 的标签：文档骨架，以及不含可指认内容的元素。 */
export const SKIP_HTML_TAGS = new Set([
  'html',
  'head',
  'body',
  'meta',
  'title',
  'link',
  'style',
  'script',
  'noscript',
  'base',
  'template',
])

/** 完整文档用 `parse`，片段用 `parseFragment`；两者都带源码位置信息。 */
export function parseHtmlSource(
  source: string,
): DefaultTreeAdapterMap['document'] | DefaultTreeAdapterMap['documentFragment'] {
  return /<!doctype\b|<html\b/i.test(source)
    ? parse(source, { sourceCodeLocationInfo: true })
    : parseFragment(source, { sourceCodeLocationInfo: true })
}

/** 读取 HTML 片段中的显式块标识，不进入嵌套模板的惰性内容。 */
export function visitHtmlBlockIds(source: string, visit: (blockId: string) => void): void {
  if (!/data-ak-block/i.test(source)) return
  const pending: DefaultTreeAdapterMap['parentNode'][] = [parseFragment(source)]
  for (let parent = pending.pop(); parent; parent = pending.pop()) {
    for (const node of parent.childNodes) {
      if (!('attrs' in node)) continue
      const blockId = node.attrs.find(({ name }) => name === 'data-ak-block')?.value.trim()
      if (blockId) visit(blockId)
      if (node.childNodes.length) pending.push(node)
    }
  }
}

/**
 * 为 HTML 或文档源码里的元素注入 `data-ak-loc="line:col"`，不改写其余内容。
 *
 * @remarks 已带 `data-ak-loc` 的元素跳过；`loc` 取起始标签的行列，从 1 起。
 */
export function injectHtmlLocations(source: string): InjectLocationsResult {
  const root = parseHtmlSource(source) as unknown as Parse5Node

  const insertions: StringInsertion[] = []
  const locations: InjectedLocationEntry[] = []
  const blocks: BlockEntry[] = []

  const walk = (node: Parse5Node): void => {
    if (node.tagName && !SKIP_HTML_TAGS.has(node.tagName.toLowerCase())) {
      const startTag = node.sourceCodeLocation?.startTag
      if (startTag && startTag.endOffset > startTag.startOffset) {
        const line = startTag.startLine
        const column = startTag.startCol
        const loc = `${line}:${column}`
        const attrs = node.attrs ?? []

        const blockAttr = attrs.find((a) => a.name.toLowerCase() === 'data-ak-block')?.value
        const idAttr = attrs.find((a) => a.name.toLowerCase() === 'id')?.value
        const blockId = blockAttr || idAttr || undefined
        if (blockAttr) {
          blocks.push({ blockId: blockAttr, loc, line, column, sourceAttr: 'data-ak-block' })
        } else if (idAttr) {
          blocks.push({ blockId: idAttr, loc, line, column, sourceAttr: 'id' })
        }

        locations.push({
          tagName: node.tagName.toLowerCase(),
          loc,
          line,
          column,
          dynamic: false,
          ...(blockId ? { blockId } : {}),
        })

        const hasLocAttr = attrs.some((a) => a.name.toLowerCase() === 'data-ak-loc')
        if (!hasLocAttr) {
          const rawStartTag = source.slice(startTag.startOffset, startTag.endOffset)
          if (rawStartTag.endsWith('/>')) {
            const beforeSlash = rawStartTag.slice(0, -2)
            const hasTrailingSpace = /\s$/.test(beforeSlash)
            insertions.push({
              offset: startTag.endOffset - 2,
              text: hasTrailingSpace ? `data-ak-loc="${loc}" ` : ` data-ak-loc="${loc}"`,
            })
          } else if (rawStartTag.endsWith('>')) {
            insertions.push({
              offset: startTag.endOffset - 1,
              text: ` data-ak-loc="${loc}"`,
            })
          }
        }
      }
    }

    if (node.childNodes) {
      for (const child of node.childNodes) {
        walk(child)
      }
    }
    if (node.content) {
      walk(node.content)
    }
  }

  walk(root)

  return {
    code: applyInsertions(source, insertions),
    locations,
    blocks,
  }
}
