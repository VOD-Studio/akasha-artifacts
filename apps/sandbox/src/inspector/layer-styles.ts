import { type CanvasLayerStyles, CANVAS_STYLE_LIMITS as LIMIT } from '@akasha/protocol'

type Declaration = CanvasLayerStyles['declarations'][number]

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_PAINT = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'text-anchor',
]
const SVG_PRESENTATION = [
  ...SVG_PAINT,
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'word-spacing',
  'visibility',
  'opacity',
  'dominant-baseline',
]

// 只归属能同时识别长属性和重置它的简写的继承项；不推断注册变量的 inherits。
const INHERITED = new Set([
  ...SVG_PAINT,
  'color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'word-spacing',
  'text-indent',
  'text-shadow',
  'visibility',
  'word-break',
  'widows',
  'orphans',
  'tab-size',
])
const FONT = ['font-family', 'font-size', 'font-style', 'font-weight', 'line-height']
// 只穿过不会自带字体、颜色等呈现的内容节点，不推断控件或 SVG 引用树的默认值。
const TRANSPARENT_HTML =
  /^(div|span|section|main|article|aside|nav|header|footer|figure|figcaption|p|label|li|ul|ol)$/
const TRANSPARENT_SVG = /^(svg|g|text|tspan|path|rect|circle|ellipse|line|polygon|polyline)$/
const NON_INHERITED =
  /^(width|height|box-sizing|display|position|inset|top|right|bottom|left|opacity|gap|transform|z-index|margin|padding|background|flex|grid)(-|$)/
const MAX_NODES = 960
const MAX_SHEETS = 64
const MAX_DEPTH = 32
const MAX_RULES = 512
const MAX_MATCHES = 2048
const MAX_PROPERTIES = 2048

type Candidate = { declaration: Declaration; priority: number; ambiguous: boolean }
type Layer = {
  element: Element
  candidates: Map<string, Candidate>
  uncertain: Set<string>
  computed?: CSSStyleDeclaration
}

// CSSOM 返回选择器列表；函数或属性值里的逗号不是分隔符。
function selectors(text: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') i++
    else if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

function ancestorLabel(node: Element): string | undefined {
  if (node.id.length > LIMIT.inheritedFrom) return undefined
  let label = node.localName
  if (node.id) label += `#${node.id}`
  else {
    if ((node.getAttribute('class')?.length ?? 0) > LIMIT.inheritedFrom) return undefined
    const name = node.classList.item(0)
    if (name) label += `.${name}`
  }
  return label.length <= LIMIT.inheritedFrom ? label : undefined
}

function mayInherit(node: Element, property: string): boolean {
  if (node.namespaceURI === SVG_NS) return TRANSPARENT_SVG.test(node.localName)
  if (
    node.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
    node.hasAttribute('align') ||
    node.hasAttribute('dir')
  )
    return false
  // 标题的默认字号、字重不能归给祖先，但这不影响文字颜色和字体族的来源。
  if (/^h[1-6]$/.test(node.localName)) return property !== 'font-size' && property !== 'font-weight'
  if (node.localName === 'strong' || node.localName === 'b') return property !== 'font-weight'
  if (node.localName === 'em' || node.localName === 'i') return property !== 'font-style'
  return TRANSPARENT_HTML.test(node.localName)
}

function hasRenderedOverride(layers: Layer[], source: Layer, property: string, win: Window) {
  let previous: string | undefined
  for (const layer of layers) {
    layer.computed ??= win.getComputedStyle(layer.element)
    const value = layer.computed.getPropertyValue(property)
    // 计算值不同可排除作品外的覆盖；相同不能证明来源，仍须先找到作者的声明。
    if (value && value !== 'inherit' && value !== 'unset') {
      if (previous !== undefined && previous !== value) return true
      previous = value
    }
    if (layer === source) break
  }
  return false
}

function validPresentation(
  property: string,
  value: string,
  win: (Window & typeof globalThis) | null,
) {
  // SVG 表现属性接受无单位的用户坐标长度，CSS.supports 按 CSS 长度解析时可能拒绝。
  if (
    /^(font-size|stroke-width)$/.test(property) &&
    /^\+?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(value)
  )
    return true
  if (win?.CSS?.supports) return win.CSS.supports(property, value)
  if (/^(fill|stroke|color)$/.test(property)) {
    return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
  }
  if (property === 'text-anchor') return /^(start|middle|end)$/.test(value)
  return false
}

/** 只回传当前作品内的声明；继承链或来源不能证实时保留本层匹配结果并标记不完整。 */
export function readLayerStyles(
  element: Element,
  root: HTMLElement,
  layerId: string,
): CanvasLayerStyles {
  const result: CanvasLayerStyles = { layerId, declarations: [], truncated: false }
  const layers: Layer[] = []
  let node: Element | null = element
  while (node && node !== root && layers.length < MAX_DEPTH) {
    layers.push({ element: node, candidates: new Map(), uncertain: new Set() })
    node = node.parentElement
  }
  if (node !== root || !layers.length) return { ...result, truncated: true }
  const wrapper = layers.findIndex((layer) => layer.element.hasAttribute('data-ak-renderer'))
  if (wrapper >= 0) layers.length = wrapper
  if (!layers.length) return { ...result, truncated: true }

  const doc = root.ownerDocument
  const win = doc.defaultView
  let complete = true
  let ruleCount = 0
  let matchCount = 0
  let propertyCount = 0

  function append(declaration: Declaration) {
    if (result.declarations.length < LIMIT.declarations) result.declarations.push(declaration)
    else result.truncated = true
  }

  function consider(layer: Layer, declaration: Declaration, priority: number) {
    if (layer === layers[0]) append(declaration)
    const { property, source } = declaration
    if (!INHERITED.has(property)) return
    const previous = layer.candidates.get(property)
    if (!previous || previous.priority < priority) {
      layer.candidates.set(property, { declaration, priority, ambiguous: false })
    } else if (previous.priority === priority) {
      // 不用猜测复杂选择器的优先级。相同选择器按源顺序，不同选择器无法唯一归属。
      previous.ambiguous ||= previous.declaration.source !== source
      previous.declaration = declaration
    }
  }

  function record(layer: Layer, style: CSSStyleDeclaration, source: string, inline: boolean) {
    for (let i = 0; i < style.length; i++) {
      if (++propertyCount > MAX_PROPERTIES) {
        complete = false
        return
      }
      const property = style[i]
      const value = style.getPropertyValue(property)
      if (property.length > LIMIT.property || !value || value.length > LIMIT.value) {
        complete = false
        continue
      }
      if (
        property === 'all' ||
        property === 'font' ||
        (/^(animation(-name)?|transition(-property)?)$/.test(property) && value !== 'none')
      ) {
        for (const key of property === 'font' ? FONT : INHERITED) layer.uncertain.add(key)
        result.truncated = true
      }
      if (layer !== layers[0] && !INHERITED.has(property)) {
        if (!NON_INHERITED.test(property)) result.truncated = true
        continue
      }
      const important = style.getPropertyPriority(property) === 'important'
      const declaration: Declaration = {
        property,
        value,
        source,
        ...(important && { important: true }),
      }
      consider(layer, declaration, Number(important) * 2 + Number(inline))
    }
  }

  function mediaMatches(query: string): boolean {
    if (!query || query === 'all') return true
    if (query.length <= LIMIT.value && win?.matchMedia) return win.matchMedia(query).matches
    complete = false
    return false
  }

  function scanRules(rules: CSSRuleList, depth: number) {
    if (depth > MAX_DEPTH) {
      complete = false
      return
    }
    for (let i = 0; i < rules.length; i++) {
      if (++ruleCount > MAX_RULES || matchCount > MAX_MATCHES || propertyCount > MAX_PROPERTIES) {
        complete = false
        return
      }
      const rule = rules[i]
      // matches() 没有样式表命名空间上下文，不能用它证明后续选择器生效。
      if (rule.type === CSSRule.NAMESPACE_RULE) {
        complete = false
        return
      }
      if (rule.type === CSSRule.MEDIA_RULE) {
        const group = rule as CSSMediaRule
        if (mediaMatches(group.media.mediaText)) scanRules(group.cssRules, depth + 1)
      } else if (rule.type === CSSRule.SUPPORTS_RULE) {
        const group = rule as CSSSupportsRule
        if (group.conditionText.length > LIMIT.value || !win?.CSS?.supports) complete = false
        else if (win.CSS.supports(group.conditionText)) scanRules(group.cssRules, depth + 1)
      } else if (rule.type === CSSRule.STYLE_RULE) {
        const entry = rule as CSSStyleRule
        if (entry.cssRules?.length) complete = false
        const text = entry.selectorText
        if (text.length > LIMIT.source || /:scope\b|:has\(|\/\*/i.test(text)) {
          complete = false
          continue
        }
        const parts = selectors(text)
        for (const layer of layers) {
          for (const selector of parts) {
            if (++matchCount > MAX_MATCHES) {
              complete = false
              return
            }
            if (!layer.element.matches(selector)) continue
            record(layer, entry.style, selector, false)
            break
          }
        }
      } else if (rule.type !== CSSRule.FONT_FACE_RULE && rule.type !== CSSRule.KEYFRAMES_RULE) {
        // 不跟随 @import；@scope、@layer、@container 等未判定的规则也可能截断继承。
        complete = false
      }
    }
  }

  for (const layer of layers) {
    if (layer.element.hasAttribute('style') && 'style' in layer.element) {
      record(layer, (layer.element as HTMLElement | SVGElement).style, 'style', true)
    }
    if (layer.element.namespaceURI !== SVG_NS) continue
    for (const property of SVG_PRESENTATION) {
      const value = layer.element.getAttribute(property)
      if (value === null) continue
      if (
        value.length > LIMIT.value ||
        !value.trim() ||
        (win?.CSS?.supports && !validPresentation(property, value.trim(), win))
      ) {
        layer.uncertain.add(property)
        result.truncated = true
        continue
      }
      // 表现属性先于作者样式参与层叠，连零优先级的匹配选择器也能覆盖它。
      consider(layer, { property, value, source: `[${property}]` }, -1)
    }
  }

  function scanOwner(owner: Element) {
    if (owner.localName === 'link' && (owner as HTMLLinkElement).relList?.contains('stylesheet')) {
      complete = false
    }
    if (owner.localName !== 'style') return
    try {
      const sheet = (owner as HTMLStyleElement).sheet
      if (!sheet) complete = false
      else if (
        !sheet.disabled &&
        mediaMatches(sheet.media?.mediaText ?? owner.getAttribute('media') ?? '')
      ) {
        scanRules(sheet.cssRules, 0)
      }
    } catch {
      // 浏览器未开放 CSSOM 或不能解析选择器时，不回退为文本猜测。
      complete = false
    }
  }
  // 大 SVG 可有数千个图元。只从文档的表索引辨认所有者，绝不读取作品外的规则。
  const sheets = doc.styleSheets
  if (sheets.length > MAX_SHEETS) complete = false
  let indexed = true
  const owners: Element[] = []
  for (let i = 0; i < Math.min(sheets.length, MAX_SHEETS); i++) {
    const owner = sheets[i].ownerNode
    if (!owner) {
      indexed = false
      break
    }
    if (owner.nodeType === Node.ELEMENT_NODE && root.contains(owner)) owners.push(owner as Element)
  }
  if (indexed) {
    for (const owner of owners) scanOwner(owner)
  } else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
    for (let i = 0, next = walker.nextNode(); next; next = walker.nextNode(), i++) {
      if (i >= MAX_NODES) {
        complete = false
        break
      }
      scanOwner(next as Element)
    }
  }
  if (!complete) return { ...result, truncated: true }

  for (const property of INHERITED) {
    let uncertain = false
    for (const layer of layers) {
      uncertain ||= layer.uncertain.has(property)
      const winner = layer.candidates.get(property)
      if (winner) {
        const declaration = winner.declaration
        const keyword = declaration.value.trim().toLowerCase()
        if (!winner.ambiguous && (keyword === 'inherit' || keyword === 'unset')) continue
        if (layer !== layers[0]) {
          const inheritedFrom = ancestorLabel(layer.element)
          if (
            uncertain ||
            winner.ambiguous ||
            !inheritedFrom ||
            (winner.priority < 0 &&
              !win?.CSS?.supports &&
              !validPresentation(property, declaration.value.trim(), win)) ||
            /^(revert|revert-layer)$|var\(/.test(keyword) ||
            !win ||
            hasRenderedOverride(layers, layer, property, win)
          ) {
            result.truncated = true
          } else append({ ...declaration, inheritedFrom })
        }
        break
      }
      uncertain ||= !mayInherit(layer.element, property)
    }
  }
  return result
}
