import {
  DESIGN_LAYER_BLOCK_PREFIX,
  type ElementRect,
  type ElementRef,
  type ShellToSandboxMessage,
} from '@akasha/protocol'
import type { SandboxBridgeClient } from '../bridge/client'
import { layerElementId, layerSelector, readDesignLayerId } from './layers'

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
 * @remarks 不在沙盒 DOM 里绘制任何高亮框或提示条，只把悬停、选中与图钉的坐标回传给外壳。
 */
export class SandboxInspector {
  private active = false
  private hoveredEl: Element | null = null
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
    const needed = this.active || Boolean(this.selectedEl) || this.trackedPins.length > 0
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

  private resolveTarget(rawTarget: EventTarget | null): Element | null {
    if (!(rawTarget instanceof Element)) return null
    const root = this.getRootEl()
    if (!root?.contains(rawTarget) || rawTarget === root) return null
    if (rawTarget.hasAttribute('data-ak-renderer')) return null
    return rawTarget
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.active) return
    const target = this.resolveTarget(event.target)
    if (target === this.hoveredEl) return
    this.hoveredEl = target
    this.bridge.send({
      type: 'inspect.hover',
      element: target ? buildElementRef(target, this.getRootEl()) : null,
    })
  }

  private readonly handlePointerLeave = () => {
    if (!this.active || !this.hoveredEl) return
    this.hoveredEl = null
    this.bridge.send({ type: 'inspect.hover', element: null })
  }

  private readonly handleClick = (event: MouseEvent) => {
    if (!this.active) return
    const target = this.resolveTarget(event.target)
    const root = this.getRootEl()
    if (!target || !root) return
    event.preventDefault()
    event.stopPropagation()
    this.selectedEl = target
    this.ensureViewportListeners()
    this.emitSelection(target, root, 'click')
  }

  private emitSelection(target: Element, root: HTMLElement, reason: 'click' | 'sync') {
    const selector = layerSelector(target, root)
    const version = this.getVersion()
    this.bridge.send({
      type: 'inspect.select',
      element: buildElementRef(target, root),
      reason,
      ...(version > 0 ? { version } : {}),
      ...(selector && selector.length <= 1024
        ? { layerId: layerElementId(target), layerSelector: selector }
        : {}),
    })
  }

  private readonly handleViewportChange = () => {
    if (!this.hoveredEl && !this.selectedEl && this.trackedPins.length === 0) return
    if (this.syncScheduled) return
    this.syncScheduled = true

    const emit = () => {
      this.syncScheduled = false
      const root = this.getRootEl()
      if (this.hoveredEl?.isConnected) {
        this.bridge.send({
          type: 'inspect.hover',
          element: buildElementRef(this.hoveredEl, root),
        })
      }
      if (root && this.selectedEl?.isConnected) this.emitSelection(this.selectedEl, root, 'sync')
      this.emitPinRects()
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(emit)
    } else {
      emit()
    }
  }

  startInspecting(): void {
    if (this.active) return
    this.active = true
    document.addEventListener('pointermove', this.handlePointerMove, true)
    document.addEventListener('pointerleave', this.handlePointerLeave, true)
    document.addEventListener('click', this.handleClick, true)
    this.ensureViewportListeners()
  }

  stopInspecting(): void {
    if (!this.active) return
    this.active = false
    this.hoveredEl = null
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerleave', this.handlePointerLeave, true)
    document.removeEventListener('click', this.handleClick, true)
    this.bridge.send({ type: 'inspect.hover', element: null })
    this.ensureViewportListeners()
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
      this.emitSelection(found, root, 'sync')
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
    if (this.hoveredEl?.isConnected) {
      this.bridge.send({
        type: 'inspect.hover',
        element: buildElementRef(this.hoveredEl, root),
      })
    }
    if (root && this.selectedEl?.isConnected) this.emitSelection(this.selectedEl, root, 'sync')
    this.emitPinRects()
  }

  dispose(): void {
    this.active = false
    this.hoveredEl = null
    this.selectedEl = null
    this.trackedPins = []
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerleave', this.handlePointerLeave, true)
    document.removeEventListener('click', this.handleClick, true)
    this.ensureViewportListeners()
  }
}
