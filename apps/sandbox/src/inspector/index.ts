import type { ElementRef } from '@akasha/protocol'
import type { SandboxBridgeClient } from '../bridge/client'

function escapeCssIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

// 生成从沙盒根容器到目标元素的稳定 CSS 选择器，作为无 blockId 与无 loc 时的降级定位。
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
    const explicit = current.getAttribute('data-ak-block')?.trim()
    if (explicit) return explicit
    current = current.parentElement
  }
  current = el
  while (current && current !== rootEl && current !== document.body) {
    const id = current.getAttribute('id')?.trim()
    if (id && id !== 'root' && !id.startsWith('ak-mmd-')) {
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

// 按 blockId > loc > selector > textPreview 优先级构造 ElementRef，并附带视口相对 rect。
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

export function findElementByRef(rootEl: Element, ref: ElementRef): Element | null {
  if (ref.blockId) {
    const esc = escapeCssIdent(ref.blockId)
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
  return null
}

// 沙盒无 UI 元素命中探测器：绝不在沙盒 DOM 内绘制任何高亮框或提示条，所有视觉叠层均由外壳负责。
export class SandboxInspector {
  private active = false
  private hoveredEl: Element | null = null
  private selectedEl: Element | null = null
  private syncScheduled = false

  constructor(
    private readonly getRootEl: () => HTMLElement | null,
    private readonly bridge: Pick<SandboxBridgeClient, 'send'>,
  ) {}

  private resolveTarget(rawTarget: EventTarget | null): Element | null {
    if (!(rawTarget instanceof Element)) return null
    const root = this.getRootEl()
    if (!root || !root.contains(rawTarget) || rawTarget === root) return null
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
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    this.selectedEl = target
    this.bridge.send({
      type: 'inspect.select',
      element: buildElementRef(target, this.getRootEl()),
    })
  }

  private readonly handleViewportChange = () => {
    if (!this.hoveredEl && !this.selectedEl) return
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
      if (this.selectedEl?.isConnected) {
        this.bridge.send({
          type: 'inspect.select',
          element: buildElementRef(this.selectedEl, root),
        })
      }
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
    window.addEventListener('scroll', this.handleViewportChange, { passive: true, capture: true })
    window.addEventListener('resize', this.handleViewportChange, { passive: true })
  }

  stopInspecting(): void {
    if (!this.active) return
    this.active = false
    this.hoveredEl = null
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerleave', this.handlePointerLeave, true)
    document.removeEventListener('click', this.handleClick, true)
    this.bridge.send({ type: 'inspect.hover', element: null })
    if (!this.selectedEl) {
      window.removeEventListener('scroll', this.handleViewportChange, true)
      window.removeEventListener('resize', this.handleViewportChange)
    }
  }

  highlight(ref: ElementRef | null): void {
    const root = this.getRootEl()
    if (!ref || !root) {
      this.selectedEl = null
      if (!this.active) {
        window.removeEventListener('scroll', this.handleViewportChange, true)
        window.removeEventListener('resize', this.handleViewportChange)
      }
      return
    }
    const found = findElementByRef(root, ref)
    this.selectedEl = found
    if (found) {
      window.addEventListener('scroll', this.handleViewportChange, { passive: true, capture: true })
      window.addEventListener('resize', this.handleViewportChange, { passive: true })
      this.bridge.send({
        type: 'inspect.select',
        element: buildElementRef(found, root),
      })
    }
  }

  // 触发一次同步重算（供无 rAF 的测试或强制刷新调用）
  syncRects(): void {
    const root = this.getRootEl()
    if (this.hoveredEl?.isConnected) {
      this.bridge.send({
        type: 'inspect.hover',
        element: buildElementRef(this.hoveredEl, root),
      })
    }
    if (this.selectedEl?.isConnected) {
      this.bridge.send({
        type: 'inspect.select',
        element: buildElementRef(this.selectedEl, root),
      })
    }
  }

  dispose(): void {
    this.active = false
    this.hoveredEl = null
    this.selectedEl = null
    document.removeEventListener('pointermove', this.handlePointerMove, true)
    document.removeEventListener('pointerleave', this.handlePointerLeave, true)
    document.removeEventListener('click', this.handleClick, true)
    window.removeEventListener('scroll', this.handleViewportChange, true)
    window.removeEventListener('resize', this.handleViewportChange)
  }
}
