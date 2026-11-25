import {
  type CanvasElementPresentation,
  DESIGN_LAYER_BLOCK_PREFIX,
  type ElementRect,
  type ElementRef,
  type ShellToSandboxMessage,
} from '@akasha/protocol'
import type { SandboxBridgeClient } from '../bridge/client'
import { layerElementId, layerSelector, readDesignLayerId, uniqueLayerBlock } from './layers'

const TEXT_ELEMENTS = new Set([
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'button',
  'label',
  'li',
  'strong',
  'em',
  'small',
  'blockquote',
  'figcaption',
  'td',
  'th',
  'dt',
  'dd',
  'code',
  'pre',
])

function isTransparentCssColor(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed || trimmed === 'transparent') return true
  const rgba = /^rgba?\(\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,\s]\s*[\d.]+\s*[,/]\s*([\d.]+%?)\s*\)$/.exec(
    trimmed,
  )
  if (!rgba) return false
  const alpha = rgba[1].endsWith('%')
    ? Number.parseFloat(rgba[1]) / 100
    : Number.parseFloat(rgba[1])
  return Number.isFinite(alpha) && alpha <= 0.01
}

function readElementPresentation(
  target: Element,
  root: HTMLElement,
): CanvasElementPresentation | undefined {
  const win = root.ownerDocument.defaultView
  if (!win?.getComputedStyle) return undefined
  const computed = win.getComputedStyle(target)
  const color = computed.color?.trim() || undefined
  let backgroundColor: string | undefined
  for (let current: Element | null = target; current; current = current.parentElement) {
    const bg = win.getComputedStyle(current).backgroundColor?.trim()
    if (bg && !isTransparentCssColor(bg)) {
      backgroundColor = bg
      break
    }
    if (current === root) break
  }
  backgroundColor ??= 'rgb(255, 255, 255)'
  const parsedSize = Number.parseFloat(computed.fontSize)
  const fontSize =
    Number.isFinite(parsedSize) && parsedSize > 0 && parsedSize <= 512
      ? Math.round(parsedSize * 10) / 10
      : undefined
  const rawWeight = computed.fontWeight?.trim().toLowerCase()
  let fontWeight: number | undefined
  if (rawWeight === 'bold') fontWeight = 700
  else if (rawWeight === 'normal') fontWeight = 400
  else {
    const numeric = Number.parseInt(rawWeight ?? '', 10)
    if (Number.isInteger(numeric) && numeric >= 100 && numeric <= 900) fontWeight = numeric
  }
  const rawAlign = computed.textAlign?.trim().toLowerCase()
  let textAlign: CanvasElementPresentation['textAlign']
  if (rawAlign === 'left' || rawAlign === 'start') textAlign = 'left'
  else if (rawAlign === 'center') textAlign = 'center'
  else if (rawAlign === 'right' || rawAlign === 'end') textAlign = 'right'
  else if (rawAlign === 'justify') textAlign = 'justify'
  const hasDirectText = Array.from(target.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  )
  const isText = hasDirectText || TEXT_ELEMENTS.has(target.localName)
  return {
    ...(color && color.length <= 64 ? { color } : {}),
    ...(backgroundColor.length <= 64 ? { backgroundColor } : {}),
    ...(fontSize !== undefined ? { fontSize } : {}),
    ...(fontWeight !== undefined ? { fontWeight } : {}),
    ...(textAlign ? { textAlign } : {}),
    isText,
  }
}

function resolveHitElement(target: Element | null, root: HTMLElement): Element | null {
  if (
    !target ||
    target === root ||
    !root.contains(target) ||
    target.hasAttribute('data-ak-renderer')
  )
    return null
  for (
    let current: Element | null = target;
    current && current !== root;
    current = current.parentElement
  ) {
    if (readDesignLayerId(current)) return current
  }
  return target
}

function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/**
 * 生成从沙盒根容器到目标元素的 CSS 选择器，作为既没有 `blockId` 也没有 `loc` 时的降级定位。
 */
export function buildCssSelector(el: Element, rootEl?: Element | null): string {
  const parts: string[] = []
  let current: Element | null = el
  while (
    current &&
    current !== rootEl &&
    current !== document.body &&
    current !== document.documentElement
  ) {
    const tag = current.tagName.toLowerCase()
    const id = current.getAttribute('id')
    if (id && id !== 'root' && !id.startsWith('ak-mmd-')) {
      parts.unshift(`${tag}#${escapeCssIdent(id)}`)
      break
    }
    const parent: Element | null = current.parentElement
    if (parent) {
      let index = 1
      let sibling = current.previousElementSibling
      while (sibling) {
        if (sibling.tagName === current.tagName) index++
        sibling = sibling.previousElementSibling
      }
      parts.unshift(`${tag}:nth-of-type(${index})`)
    } else {
      parts.unshift(tag)
    }
    current = parent
  }
  return parts.join(' > ') || el.tagName.toLowerCase()
}

function readBlockId(el: Element, rootEl?: Element | null): string | undefined {
  // 优先查找显式声明的 data-ak-block，避免被内部普通表单元素的 id 覆盖
  let current: Element | null = el
  while (current && current !== rootEl && current !== document.body) {
    const designId = readDesignLayerId(current)
    if (designId) return `${DESIGN_LAYER_BLOCK_PREFIX}${designId}`
    const explicit = current.getAttribute('data-ak-block')?.trim()
    if (explicit && !explicit.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) return explicit
    current = current.parentElement
  }
  current = el
  while (current && current !== rootEl && current !== document.body) {
    const id = current.getAttribute('id')?.trim()
    if (
      id &&
      id !== 'root' &&
      !id.startsWith('ak-mmd-') &&
      !id.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
    ) {
      return id
    }
    current = current.parentElement
  }
  return undefined
}

function readLoc(el: Element, rootEl?: Element | null): string | undefined {
  let current: Element | null = el
  while (current && current !== rootEl && current !== document.body) {
    const loc = current.getAttribute('data-ak-loc')?.trim()
    if (loc && /^\d+:\d+(?:-\d+:\d+)?$/.test(loc)) return loc
    current = current.parentElement
  }
  return undefined
}

/** AST 直改只接受目标本身的唯一静态位置，不使用批注允许的祖先定位。 */
export function uniqueStaticSourceLocation(target: Element, root: Element) {
  const loc = target.getAttribute('data-ak-loc')
  return loc &&
    /^\d{1,8}:\d{1,8}$/.test(loc) &&
    !target.closest('[data-ak-dynamic]') &&
    root.querySelectorAll(`[data-ak-loc="${loc}"]`).length === 1
    ? loc
    : undefined
}

function readRect(el: Element): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.x * 100) / 100,
    y: Math.round(r.y * 100) / 100,
    width: Math.max(0, Math.round(r.width * 100) / 100),
    height: Math.max(0, Math.round(r.height * 100) / 100),
  }
}

/**
 * 按 `blockId` > `loc` > `selector` > `textPreview` 构造 `ElementRef`，并附带相对视口的 `rect`。
 */
export function buildElementRef(el: Element, rootEl?: Element | null): ElementRef {
  const blockId = readBlockId(el, rootEl)
  const loc = readLoc(el, rootEl)
  const selector = buildCssSelector(el, rootEl)
  const rawText = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const textPreview = rawText ? rawText.slice(0, 160) : undefined

  return {
    ...(blockId ? { blockId } : {}),
    ...(loc ? { loc } : {}),
    selector,
    rect: readRect(el),
    ...(textPreview ? { textPreview } : {}),
  }
}

/**
 * 按 `blockId` > `loc` > `selector` > `textPreview` 的顺序查找元素。
 *
 * @returns 第一个匹配的元素；都找不到时返回 `null`。
 */
export function findElementByRef(rootEl: Element, ref: ElementRef): Element | null {
  if (ref.blockId) {
    const esc = escapeCssIdent(ref.blockId)
    if (ref.blockId.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) {
      const id = ref.blockId.slice(DESIGN_LAYER_BLOCK_PREFIX.length)
      for (const element of rootEl.querySelectorAll(`[data-ak-block="${esc}"]`)) {
        if (readDesignLayerId(element) === id) return element
      }
      return null
    }
    const byBlock =
      rootEl.querySelector(`[data-ak-block="${esc}"]`) ?? rootEl.querySelector(`#${esc}`)
    if (byBlock) return byBlock
  }
  if (ref.loc) {
    const byLoc = rootEl.querySelector(`[data-ak-loc="${ref.loc}"]`)
    if (byLoc) return byLoc
  }
  if (ref.selector) {
    try {
      const bySelector = rootEl.querySelector(ref.selector)
      if (bySelector) return bySelector
    } catch {
      // 非法选择器忽略
    }
  }
  // 最终降级：按 textPreview 查找最具体的文本命中节点（遵循 blockId > loc > selector > textPreview 契约）
  const needle = ref.textPreview?.replace(/\s+/g, ' ').trim()
  if (needle) {
    let exactMatch: Element | null = null
    let partialMatch: Element | null = null
    const all = rootEl.querySelectorAll('*')
    for (const el of all) {
      if (el.hasAttribute('data-ak-renderer')) continue
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (!text) continue
      if (text === needle) {
        exactMatch = el
      } else if (text.includes(needle)) {
        partialMatch = el
      }
    }
    if (exactMatch) return exactMatch
    if (partialMatch) return partialMatch
  }
  return null
}

/**
 * 沙盒内的元素命中探测器。
 *
 * @remarks 只回传命中、选区及图钉坐标，不在作品 DOM 内绘制外壳 UI。
 */
export class SandboxInspector {
  private selectedEl: Element | null = null
  private trackedPins: Array<{ id: string; element: ElementRef }> = []
  private viewportListening = false
  private syncScheduled = false

  constructor(
    private readonly getRootEl: () => HTMLElement | null,
    private readonly bridge: Pick<SandboxBridgeClient, 'send'>,
    private readonly getVersion: () => number = () => 0,
  ) {}

  private ensureViewportListeners(): void {
    const needed = Boolean(this.selectedEl) || this.trackedPins.length > 0
    if (needed && !this.viewportListening) {
      this.viewportListening = true
      window.addEventListener('scroll', this.handleViewportChange, { passive: true, capture: true })
      window.addEventListener('resize', this.handleViewportChange, { passive: true })
    } else if (!needed && this.viewportListening) {
      this.viewportListening = false
      window.removeEventListener('scroll', this.handleViewportChange, true)
      window.removeEventListener('resize', this.handleViewportChange)
    }
  }

  private emitPinRects(): void {
    if (this.trackedPins.length === 0) return
    const root = this.getRootEl()
    const rects: Record<string, ElementRect | null> = {}
    for (const pin of this.trackedPins) {
      const el = root ? findElementByRef(root, pin.element) : null
      rects[pin.id] = el?.isConnected ? readRect(el) : null
    }
    this.bridge.send({ type: 'pins.rects', rects })
  }

  /** 只命中当前已渲染的视口，不模拟任何作者脚本可以接到的点击。 */
  inspectAt(message: Extract<ShellToSandboxMessage, { type: 'inspect.at' }>): void {
    if (message.version !== this.getVersion()) return
    const root = this.getRootEl()
    if (!root) return
    const hit = resolveHitElement(root.ownerDocument.elementFromPoint(message.x, message.y), root)
    const picking = message.purpose === 'select'
    if (picking) {
      this.selectedEl = hit
      this.ensureViewportListeners()
    }
    const selector = picking && hit ? layerSelector(hit, root) : undefined
    const presentation = picking && hit ? readElementPresentation(hit, root) : undefined
    this.bridge.send({
      type: 'inspect.target',
      purpose: message.purpose,
      requestId: message.requestId,
      version: message.version,
      element: hit ? buildElementRef(hit, root) : null,
      ...(hit && selector && selector.length <= 1024
        ? { layer: { id: layerElementId(hit), selector, blockId: uniqueLayerBlock(hit, root) } }
        : {}),
      loc: hit && !picking ? uniqueStaticSourceLocation(hit, root) : undefined,
      ...(presentation ? { presentation } : {}),
    })
  }

  private emitSelection(target: Element, root: HTMLElement) {
    const selector = layerSelector(target, root)
    const version = this.getVersion()
    const presentation = readElementPresentation(target, root)
    this.bridge.send({
      type: 'inspect.select',
      element: buildElementRef(target, root),
      reason: 'sync',
      ...(version > 0 ? { version } : {}),
      ...(selector && selector.length <= 1024
        ? { layerId: layerElementId(target), layerSelector: selector }
        : {}),
      ...(presentation ? { presentation } : {}),
    })
  }

  private readonly handleViewportChange = () => {
    if (!this.selectedEl && this.trackedPins.length === 0) return
    if (this.syncScheduled) return
    this.syncScheduled = true

    const emit = () => {
      this.syncScheduled = false
      this.syncRects()
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(emit)
    } else {
      emit()
    }
  }

  highlight(
    ref: ElementRef | null,
    reveal?: true,
    layer?: Extract<ShellToSandboxMessage, { type: 'highlight' }>['layer'],
  ): void {
    const root = this.getRootEl()
    if (!ref || !root) {
      this.selectedEl = null
      this.ensureViewportListeners()
      return
    }
    if (layer && this.getVersion() !== layer.version) return
    const found = findElementByRef(root, ref)
    if (layer && (!found || layerElementId(found) !== layer.id)) return
    this.selectedEl = found
    this.ensureViewportListeners()
    if (found) {
      if (reveal) found.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      this.emitSelection(found, root)
    }
  }

  trackPins(pins: ReadonlyArray<{ id: string; element: ElementRef }>): void {
    this.trackedPins = [...pins]
    this.ensureViewportListeners()
    this.emitPinRects()
  }

  // 触发一次同步重算（供无 rAF 的测试、容器尺寸变化或强制刷新调用）
  syncRects(): void {
    const root = this.getRootEl()
    if (root && this.selectedEl?.isConnected) this.emitSelection(this.selectedEl, root)
    this.emitPinRects()
  }

  dispose(): void {
    this.selectedEl = null
    this.trackedPins = []
    this.ensureViewportListeners()
  }
}
