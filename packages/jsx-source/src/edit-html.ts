import { type DefaultTreeAdapterTypes, defaultTreeAdapter } from 'parse5'
import type { LiteralTarget, SourcePatch } from './edit.js'
import { parseHtmlSource, SKIP_HTML_TAGS } from './html-loc.js'

// 内容按原始文本处理的标签；其中没有可解析的子元素
const RAW_TEXT: Record<string, true> = {
  iframe: true,
  noembed: true,
  noframes: true,
  plaintext: true,
  xmp: true,
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function htmlAttributeEditor(
  source: string,
  node: DefaultTreeAdapterTypes.Element,
  startTag: { startOffset: number; endOffset: number },
) {
  return (name: string, value: string | null): SourcePatch | null => {
    const loc = node.sourceCodeLocation?.attrs?.[name]
    if (!loc) {
      if (value === null) return null
      const end =
        source.charAt(startTag.endOffset - 2) === '/'
          ? startTag.endOffset - 2
          : startTag.endOffset - 1
      return {
        start: end,
        end,
        replacement: ` ${name}="${escapeHtmlText(value).replaceAll('"', '&quot;')}"`,
      }
    }
    if (value === null) {
      let start = loc.startOffset
      while (start > startTag.startOffset && /[ \t]/.test(source.charAt(start - 1))) start--
      return { start, end: loc.endOffset, replacement: '' }
    }
    const assignment = /^[^=\s]+\s*=\s*/.exec(source.slice(loc.startOffset, loc.endOffset))
    if (!assignment) {
      return {
        start: loc.endOffset,
        end: loc.endOffset,
        replacement: `="${escapeHtmlText(value).replaceAll('"', '&quot;')}"`,
      }
    }
    const start = loc.startOffset + assignment[0].length
    const previousQuote = source.charAt(start)
    const quote = previousQuote === "'" || previousQuote === '"' ? previousQuote : ''
    const finalQuote = quote || (/^[^\s"'`=<>]+$/.test(value) ? '' : '"')
    let escaped = escapeHtmlText(value)
    if (finalQuote)
      escaped = escaped.replaceAll(finalQuote, finalQuote === "'" ? '&#39;' : '&quot;')
    return { start, end: loc.endOffset, replacement: `${finalQuote}${escaped}${finalQuote}` }
  }
}

/** 收集 HTML 源码里可直改的静态节点，以 `loc` 为键。 */
export function collectHtmlTargets(source: string): Map<string, LiteralTarget> {
  const root = parseHtmlSource(source)
  const targets = new Map<string, LiteralTarget>()
  const byNode = new Map<DefaultTreeAdapterTypes.Node, LiteralTarget>()

  function walk(node: DefaultTreeAdapterTypes.Node): void {
    if (!('childNodes' in node)) return
    const isElement = defaultTreeAdapter.isElementNode(node)
    if (isElement && (node.tagName === 'template' || Object.hasOwn(RAW_TEXT, node.tagName))) return
    for (const child of node.childNodes) walk(child)
    if (
      !isElement ||
      SKIP_HTML_TAGS.has(node.tagName) ||
      node.attrs.some((attr) => attr.name === 'data-ak-loc' || attr.name === 'data-ak-dynamic')
    )
      return
    const location = node.sourceCodeLocation
    const startTag = location?.startTag
    if (!location || !startTag) return
    const loc = `${startTag.startLine}:${startTag.startCol}`
    const first = node.childNodes[0]
    const text: LiteralTarget['text'] =
      location.endTag &&
      (node.childNodes.length === 0 ||
        (first && node.childNodes.length === 1 && defaultTreeAdapter.isTextNode(first)))
        ? {
            value: first && defaultTreeAdapter.isTextNode(first) ? first.value : '',
            patch: (value) => ({
              start: startTag.endOffset,
              end: location.endTag?.startOffset ?? startTag.endOffset,
              replacement: escapeHtmlText(value),
            }),
          }
        : null
    const entry: LiteralTarget = {
      loc,
      tagName: node.tagName,
      start: location.startOffset,
      end: location.endOffset,
      text,
      className: node.attrs.find((attr) => attr.name === 'class')?.value ?? '',
      attribute: htmlAttributeEditor(source, node, startTag),
      removal: '',
    }
    const siblings: LiteralTarget[] = []
    let previousEnd = startTag.endOffset
    const end = location.endTag?.startOffset ?? location.endOffset
    for (const child of node.childNodes) {
      const target = byNode.get(child)
      if (target && target.start >= previousEnd && target.end <= end) {
        siblings.push(target)
        previousEnd = target.end
      } else if (
        child.nodeName !== '#comment' &&
        !(defaultTreeAdapter.isTextNode(child) && !child.value.trim())
      ) {
        break
      }
      if (child === node.childNodes.at(-1)) {
        entry.children = siblings
        for (const sibling of siblings) sibling.parentLoc = loc
      }
    }
    byNode.set(node, entry)
    targets.set(loc, entry)
  }

  walk(root)
  return targets
}
