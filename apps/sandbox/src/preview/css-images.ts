type ImageUrl = string | Promise<string>

interface Replacement {
  start: number
  end: number
  value: ImageUrl
}

function assemble(source: string, replacements: readonly Replacement[]): ImageUrl {
  if (!replacements.length) return source
  const parts: ImageUrl[] = []
  let cursor = 0
  for (const { start, end, value } of replacements) {
    parts.push(source.slice(cursor, start), value)
    cursor = end
  }
  parts.push(source.slice(cursor))
  if (parts.every((part) => typeof part === 'string')) return parts.join('')
  return Promise.all(parts).then((resolved) => resolved.join(''))
}

function cssUnescape(value: string): string {
  return value.replace(
    /\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|(\r\n|[\s\S]))/gi,
    (_, hex, escaped) => {
      if (!hex) return /^[\r\n\f]/.test(escaped) ? '' : escaped
      const code = Number.parseInt(hex, 16)
      const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      return String.fromCodePoint(invalid ? 0xfffd : code)
    },
  )
}

/** 仅处理可绘制的 CSS URL；保留本地 SVG 片段、CSS 注释、字符串及字体。 */
export function rewriteCssImages(css: string, map: (url: string) => ImageUrl): ImageUrl {
  if (!/[@\\]|(?:url|image(?:-set)?|src)\(/i.test(css)) return css
  const tokens =
    /\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|@?(?:\\(?:[\da-f]{1,6}(?:\r\n|\s)?|[^\n\r\f])|[-\w]|[\u0080-\u{10ffff}])+|[(){};]/giu
  const urlContents =
    /\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\(?:[\da-f]{1,6}(?:\r\n|\s)?|[^\n\r\f])|[^\\\s'"()])*))\s*\)/iy
  const replacements: Replacement[] = []
  const functions: string[] = []
  const blocks: boolean[] = []
  let fontFace = false
  let importStart: number | undefined
  for (let token = tokens.exec(css); token; token = tokens.exec(css)) {
    const raw = token[0]
    if (raw.startsWith('/*')) continue
    if (raw[0] === '"' || raw[0] === "'") {
      const parent = functions.at(-1)
      if (
        importStart === undefined &&
        (parent === 'image-set' || parent === '-webkit-image-set' || parent === 'image')
      ) {
        const url = cssUnescape(raw.slice(1, -1))
        const value = map(url)
        if (url !== value) {
          const encoded =
            typeof value === 'string' ? JSON.stringify(value) : value.then(JSON.stringify)
          replacements.push({ start: token.index, end: tokens.lastIndex, value: encoded })
        }
      }
      continue
    }
    if (raw === ')') {
      functions.pop()
      continue
    }
    if (raw === '(') {
      functions.push('')
      continue
    }
    if (!functions.length) {
      if (raw === '{') {
        blocks.push(fontFace || blocks.at(-1) === true)
        fontFace = false
        continue
      }
      if (raw === '}') {
        blocks.pop()
        continue
      }
      if (raw === ';' && importStart !== undefined) {
        replacements.push({ start: importStart, end: tokens.lastIndex, value: '' })
        importStart = undefined
        continue
      }
    }
    const name = cssUnescape(raw).toLowerCase()
    if (name === '@font-face') fontFace = true
    // 外部样式表不在可重写的 DOM 里，不能保证其中的图片静止。
    if (name === '@import' && importStart === undefined) importStart = token.index
    if (css[tokens.lastIndex] !== '(') continue
    tokens.lastIndex++
    if (name === 'url' || name === 'src') {
      urlContents.lastIndex = tokens.lastIndex
      const contents = urlContents.exec(css)
      if (contents) {
        if (importStart === undefined && !blocks.at(-1)) {
          const url = cssUnescape(contents[1] ?? contents[2] ?? contents[3])
          const value = map(url)
          if (url !== value) {
            const format = (next: string) => `url(${JSON.stringify(next)})`
            replacements.push({
              start: token.index,
              end: urlContents.lastIndex,
              value: typeof value === 'string' ? format(value) : value.then(format),
            })
          }
        }
        tokens.lastIndex = urlContents.lastIndex
        continue
      }
    }
    functions.push(name)
  }
  if (importStart !== undefined)
    replacements.push({ start: importStart, end: css.length, value: '' })
  return assemble(css, replacements)
}

/** 保留候选图的媒体尺寸描述符；数据 URI 中的内部逗号不是候选项分隔符。 */
export function rewriteImageSrcset(srcset: string, map: (url: string) => ImageUrl): ImageUrl {
  const candidates: Replacement[] = []
  const token = /[^\t\n\f\r ,][^\t\n\f\r ]*/g
  for (let match = token.exec(srcset); match; match = token.exec(srcset)) {
    const url = match[0].replace(/,+$/, '')
    const value = map(url)
    if (url !== value) candidates.push({ start: match.index, end: match.index + url.length, value })
    if (url.length < match[0].length) continue
    // 描述符中的括号不是候选项分隔符。浏览器负责丢弃无效描述符。
    let depth = 0
    for (; token.lastIndex < srcset.length; token.lastIndex++) {
      const char = srcset[token.lastIndex]
      if (char === ',' && depth === 0) break
      if (char === '(') depth++
      else if (char === ')' && depth > 0) depth--
    }
  }
  return assemble(srcset, candidates)
}
