/** HTML 静态元素的画布几何直改补丁（基于源码起始标签行列定位）。 */
export interface HtmlElementGeometryPatch {
  /** 在原有 `translate` 基础上叠加的画板像素偏移量。 */
  translateDelta?: { dx: number; dy: number }
  /** 目标宽度（画板固有像素）；仅在水平/四角拉伸时设置。 */
  width?: number
  /** 目标高度（画板固有像素）；仅在垂直/四角拉伸时设置。 */
  height?: number
}

const SKIP_TAGS = new Set([
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

const INLINE_TAGS = new Set([
  'span',
  'a',
  'strong',
  'em',
  'small',
  'b',
  'i',
  'u',
  'code',
  'label',
  'mark',
  'abbr',
  'cite',
  'time',
  'sub',
  'sup',
])

function offsetForLineCol(source: string, loc: string): number {
  const match = /^(\d+):(\d+)$/.exec(loc.trim())
  if (!match) return -1
  const targetLine = Number.parseInt(match[1], 10)
  const targetCol = Number.parseInt(match[2], 10)
  if (targetLine < 1 || targetCol < 1) return -1
  let line = 1
  let index = 0
  while (line < targetLine && index < source.length) {
    const ch = source.charCodeAt(index)
    if (ch === 13) {
      index += source.charCodeAt(index + 1) === 10 ? 2 : 1
      line++
    } else if (ch === 10) {
      index++
      line++
    } else {
      index++
    }
  }
  if (line !== targetLine) return -1
  const offset = index + targetCol - 1
  return offset >= 0 && offset < source.length ? offset : -1
}

function findOpeningTagEnd(source: string, start: number): number {
  let quote: string | null = null
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '>') return i
  }
  return -1
}

interface StyleAttributeSpan {
  valueStart: number
  valueEnd: number
  quote: '"' | "'" | ''
  rawValue: string
}

function findStyleAttribute(
  source: string,
  tagStart: number,
  tagEnd: number,
): StyleAttributeSpan | null {
  let i = tagStart + 1
  while (i < tagEnd && /[a-zA-Z0-9_:-]/.test(source[i])) i++
  while (i < tagEnd) {
    while (i < tagEnd && /[\s/]/.test(source[i])) i++
    if (i >= tagEnd) break
    const nameStart = i
    while (i < tagEnd && !/[\s=/>]/.test(source[i])) i++
    const name = source.slice(nameStart, i).toLowerCase()
    while (i < tagEnd && /\s/.test(source[i])) i++
    if (source[i] !== '=') continue
    i++
    while (i < tagEnd && /\s/.test(source[i])) i++
    if (i >= tagEnd) break
    let quote: '"' | "'" | '' = ''
    let valueStart = i
    let valueEnd = i
    if (source[i] === '"' || source[i] === "'") {
      quote = source[i] as '"' | "'"
      valueStart = i + 1
      i++
      while (i < tagEnd && source[i] !== quote) i++
      valueEnd = i
      if (i < tagEnd) i++
    } else {
      while (i < tagEnd && !/[\s/>]/.test(source[i])) i++
      valueEnd = i
    }
    if (name === 'style') {
      return {
        valueStart,
        valueEnd,
        quote,
        rawValue: source.slice(valueStart, valueEnd),
      }
    }
  }
  return null
}

function decodeAttrValue(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function encodeAttrValue(value: string, quote: '"' | "'"): string {
  const escaped = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return quote === "'" ? escaped.replaceAll("'", '&#39;') : escaped.replaceAll('"', '&quot;')
}

function parseInlineDeclarations(styleText: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  let quote: string | null = null
  let parenDepth = 0
  let start = 0

  const pushChunk = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) return
    const colon = trimmed.indexOf(':')
    if (colon <= 0) return
    const prop = trimmed.slice(0, colon).trim().toLowerCase()
    const val = trimmed.slice(colon + 1).trim()
    if (!prop || !val) return
    const existing = entries.findIndex(([key]) => key === prop)
    if (existing >= 0) entries[existing] = [prop, val]
    else entries.push([prop, val])
  }

  for (let i = 0; i < styleText.length; i++) {
    const ch = styleText[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '(') {
      parenDepth++
      continue
    }
    if (ch === ')' && parenDepth > 0) {
      parenDepth--
      continue
    }
    if (ch === ';' && parenDepth === 0) {
      pushChunk(styleText.slice(start, i))
      start = i + 1
    }
  }
  pushChunk(styleText.slice(start))
  return entries
}

function parsePxTranslate(value: string | undefined): { x: number; y: number } {
  if (!value) return { x: 0, y: 0 }
  const parts = value.trim().split(/\s+/)
  const parsePart = (token: string | undefined): number => {
    if (!token) return 0
    if (token === '0') return 0
    const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(token)
    return match ? Number.parseFloat(match[1]) : 0
  }
  return { x: parsePart(parts[0]), y: parsePart(parts[1]) }
}

function upsertDeclaration(entries: Array<[string, string]>, prop: string, value: string | null) {
  const index = entries.findIndex(([key]) => key === prop)
  if (value === null) {
    if (index >= 0) entries.splice(index, 1)
    return
  }
  if (index >= 0) entries[index] = [prop, value]
  else entries.push([prop, value])
}

/**
 * 按 `data-ak-loc` 行列定位原 HTML 起始标签并更新内联 `style` 中的位移与尺寸，
 * 保留文档其余内容与原有起始行列，不引入换行也不破坏已有 `transform` 或样式。
 */
export function patchHtmlElementGeometry(
  html: string,
  loc: string,
  patch: HtmlElementGeometryPatch,
): string {
  const dx = Math.round(patch.translateDelta?.dx ?? 0)
  const dy = Math.round(patch.translateDelta?.dy ?? 0)
  const hasMove = dx !== 0 || dy !== 0
  const hasWidth = patch.width !== undefined && Number.isFinite(patch.width) && patch.width >= 1
  const hasHeight = patch.height !== undefined && Number.isFinite(patch.height) && patch.height >= 1
  if (!hasMove && !hasWidth && !hasHeight) return html

  const start = offsetForLineCol(html, loc)
  if (start < 0 || html[start] !== '<') {
    throw new Error('无法在画板源码中定位该元素')
  }
  const tagMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(start))
  if (!tagMatch) throw new Error('无法识别该 HTML 元素标签')
  const tagName = tagMatch[1].toLowerCase()
  if (SKIP_TAGS.has(tagName)) throw new Error('该文档结构标签不支持移动或拉伸')

  const tagEnd = findOpeningTagEnd(html, start)
  if (tagEnd < 0) throw new Error('HTML 起始标签不完整')

  const styleSpan = findStyleAttribute(html, start, tagEnd)
  const declarations = parseInlineDeclarations(styleSpan ? decodeAttrValue(styleSpan.rawValue) : '')

  if (hasMove) {
    const existing = declarations.find(([key]) => key === 'translate')?.[1]
    const prev = parsePxTranslate(existing)
    const nextX = Math.round(prev.x + dx)
    const nextY = Math.round(prev.y + dy)
    upsertDeclaration(
      declarations,
      'translate',
      nextX === 0 && nextY === 0 ? null : `${nextX}px ${nextY}px`,
    )
  }
  if (hasWidth && patch.width !== undefined) {
    upsertDeclaration(declarations, 'width', `${Math.round(patch.width)}px`)
    upsertDeclaration(declarations, 'max-width', 'none')
    upsertDeclaration(declarations, 'box-sizing', 'border-box')
  }
  if (hasHeight && patch.height !== undefined) {
    upsertDeclaration(declarations, 'height', `${Math.round(patch.height)}px`)
    upsertDeclaration(declarations, 'box-sizing', 'border-box')
  }
  if (INLINE_TAGS.has(tagName) && !declarations.some(([key]) => key === 'display')) {
    upsertDeclaration(declarations, 'display', 'inline-block')
  }

  const nextStyle = declarations.map(([k, v]) => `${k}: ${v}`).join('; ')
  if (!styleSpan) {
    if (!nextStyle) return html
    const selfClosing = html[tagEnd - 1] === '/'
    const insertAt = selfClosing ? tagEnd - 1 : tagEnd
    const needsTrailingSpace = selfClosing && html[insertAt - 1] !== ' '
    const encoded = encodeAttrValue(nextStyle, '"')
    const insertion = needsTrailingSpace ? ` style="${encoded}" ` : ` style="${encoded}"`
    return html.slice(0, insertAt) + insertion + html.slice(insertAt)
  }

  const quote: '"' | "'" = styleSpan.quote === "'" ? "'" : '"'
  const encoded = encodeAttrValue(nextStyle, quote)
  if (styleSpan.quote) {
    return html.slice(0, styleSpan.valueStart) + encoded + html.slice(styleSpan.valueEnd)
  }
  return `${html.slice(0, styleSpan.valueStart)}${quote}${encoded}${quote}${html.slice(styleSpan.valueEnd)}`
}
