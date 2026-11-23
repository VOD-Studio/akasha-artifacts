import type { CanvasLayer } from '@akasha/protocol'

const SKIP = 'script, style, link, meta, title, template, noscript, defs'
const MAX_DEPTH = 14
const MAX_LAYERS = 240
const MAX_VISITED = 960
const layerIds = new WeakMap<Element, string>()
const designLayerIds = new WeakMap<Element, string>()
const scopeId = crypto.getRandomValues(new Uint32Array(2)).join('-')
let nextLayerId = 0

/** 原生层的标识只由负责渲染该对象的代码登记，不能在作者 HTML 中声明。 */
export function bindDesignLayer(element: Element, id: string): void {
  designLayerIds.set(element, id)
}

/** 返回渲染器登记的原生对象标识。 */
export function readDesignLayerId(element: Element): string | undefined {
  return designLayerIds.get(element)
}

/** 沙盒会话内，一个存续节点的标识不随兄弟节点重排变化。 */
export function layerElementId(element: Element): string {
  const previous = layerIds.get(element)
  if (previous) return previous
  const id = `${scopeId}:${++nextLayerId}`
  layerIds.set(element, id)
  return id
}

function segment(element: Element, index: number): string {
  return `${element.localName.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}:nth-of-type(${index})`
}

/** 完整结构路径不会被重复 HTML id 或祖先块标识误导。 */
export function layerSelector(element: Element, root: Element): string {
  const parts: string[] = []
  for (
    let current: Element | null = element;
    current && current !== root;
    current = current.parentElement
  ) {
    let index = 1
    for (
      let sibling = current.previousElementSibling;
      sibling;
      sibling = sibling.previousElementSibling
    ) {
      if (sibling.localName === current.localName) index += 1
    }
    parts.unshift(segment(current, index))
  }
  return parts.length ? `:scope > ${parts.join(' > ')}` : ''
}

function layerLabel(element: Element): string | undefined {
  const label = element.getAttribute('aria-label') ?? element.getAttribute('title')
  if (label?.trim()) return label.trim().slice(0, 120)
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue
    const text = child.textContent?.trim()
    if (text) return text.replace(/\s+/g, ' ').slice(0, 120)
  }
  return undefined
}

/** 只给具备唯一静态标记的节点关联源码；重复判断包括未展示的节点。 */
export function readCanvasLayers(root: HTMLElement) {
  const layers: CanvasLayer[] = []
  const locations: Array<{ layer: CanvasLayer; location: string }> = []
  let visited = 0
  let truncated = false

  function scan(parent: Element, prefix: string, parentId: string | undefined, depth: number) {
    const siblings = new Map<string, number>()
    for (const element of parent.children) {
      visited += 1
      if (layers.length >= MAX_LAYERS || visited > MAX_VISITED) {
        truncated = true
        return
      }
      const tag = element.localName
      const index = (siblings.get(tag) ?? 0) + 1
      siblings.set(tag, index)
      if (element.matches(SKIP) || element.hasAttribute('hidden')) continue
      const part = segment(element, index)
      const path = prefix ? `${prefix} > ${part}` : part
      const selector = `:scope > ${path}`
      if (depth >= MAX_DEPTH || selector.length > 1024) {
        truncated = true
        continue
      }
      if (element.hasAttribute('data-ak-renderer')) {
        scan(element, path, parentId, depth + 1)
        continue
      }
      const id = layerElementId(element)
      const label = layerLabel(element)
      const designId = readDesignLayerId(element)
      const bounds = element.getBoundingClientRect()
      const layer: CanvasLayer = {
        id,
        selector,
        ...(parentId !== undefined ? { parentId } : {}),
        tag: tag.slice(0, 80),
        ...(label ? { label } : {}),
        ...(designId ? { designId } : {}),
        width: Math.max(0, Math.round(bounds.width * 10) / 10),
        height: Math.max(0, Math.round(bounds.height * 10) / 10),
      }
      layers.push(layer)
      if (designId) continue
      const loc = element.getAttribute('data-ak-loc')
      if (loc && /^\d{1,8}:\d{1,8}$/.test(loc) && !element.closest('[data-ak-dynamic]')) {
        locations.push({ layer, location: loc })
      }
      scan(element, path, id, depth + 1)
    }
  }

  scan(root, '', undefined, 0)
  if (locations.length) {
    const counts = new Map<string, number>()
    for (const element of root.querySelectorAll('[data-ak-loc]')) {
      const loc = element.getAttribute('data-ak-loc')
      if (loc) counts.set(loc, (counts.get(loc) ?? 0) + 1)
    }
    for (const { layer, location } of locations) {
      if (counts.get(location) === 1) layer.sourceLoc = location
    }
  }
  return { layers, truncated }
}
