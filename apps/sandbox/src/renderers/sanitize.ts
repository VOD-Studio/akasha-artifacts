const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base'])
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction'])

function isUnsafeUrl(value: string): boolean {
  // 去除不可见控制字符（<= 0x20）后检测协议前缀
  let normalized = ''
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 32) {
      normalized += value[i]
    }
  }
  const lower = normalized.toLowerCase()
  return (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html')
  )
}

function scrubNode(el: Element): void {
  const attrs = Array.from(el.attributes)
  for (const attr of attrs) {
    const name = attr.name.toLowerCase()
    if (name.startsWith('on')) {
      el.removeAttribute(attr.name)
      continue
    }
    if (URL_ATTRS.has(name) && isUnsafeUrl(attr.value)) {
      el.removeAttribute(attr.name)
    }
  }
  const children = Array.from(el.children)
  for (const child of children) {
    if (FORBIDDEN_TAGS.has(child.tagName.toLowerCase())) {
      child.remove()
    } else {
      scrubNode(child)
    }
  }
}

// 净化 Markdown / SVG 输出 DOM：剥离 script、危险嵌入标签、内联 on* 事件与 javascript: URL。
export function sanitizeMarkup(markup: string, mode: 'html' | 'svg' = 'html'): string {
  if (typeof DOMParser === 'undefined') {
    return markup
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }

  if (mode === 'svg') {
    const parser = new DOMParser()
    const doc = parser.parseFromString(markup, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.tagName.toLowerCase() === 'parsererror') {
      // 回退为 HTML 片段解析以容忍不带 xmlns 的 SVG
      const htmlDoc = parser.parseFromString(`<div>${markup}</div>`, 'text/html')
      const wrapper = htmlDoc.body.firstElementChild
      if (!wrapper) return ''
      scrubNode(wrapper)
      return wrapper.innerHTML
    }
    scrubNode(root)
    return new XMLSerializer().serializeToString(root)
  }

  const template = document.createElement('template')
  template.innerHTML = markup
  for (const child of Array.from(template.content.children)) {
    if (FORBIDDEN_TAGS.has(child.tagName.toLowerCase())) {
      child.remove()
    } else {
      scrubNode(child)
    }
  }
  return template.innerHTML
}
