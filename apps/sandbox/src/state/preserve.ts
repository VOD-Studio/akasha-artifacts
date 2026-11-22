import type { PreservedViewState } from '@akasha/protocol'
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react'

type PersistableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function isWindowScroller(target: HTMLElement | Window): target is Window {
  return (
    (typeof window !== 'undefined' && target === window) ||
    (typeof Window !== 'undefined' && target instanceof Window)
  )
}

function isPersistableElement(el: Element): el is PersistableElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  )
}

function readElementValue(el: PersistableElement): unknown {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked
    if (el.type === 'radio') return el.checked ? el.value : undefined
    if (el.type === 'number' || el.type === 'range') {
      const n = Number(el.value)
      return Number.isNaN(n) ? el.value : n
    }
    return el.value
  }
  return el.value
}

function writeElementValue(el: PersistableElement, value: unknown): void {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') {
      el.checked = Boolean(value)
      return
    }
    if (el.type === 'radio') {
      el.checked = String(value) === el.value
      return
    }
    el.value = String(value)
    return
  }
  el.value = String(value)
}

// 热更新视图与控件保态管理器：收集用户调整过的滑块/输入值与滚动位置，在 render 重绘时无感恢复。
export class PreservedStateManager {
  private state: PreservedViewState = { controls: {} }
  private readonly listeners = new Set<() => void>()
  private onSnapshot?: (state: PreservedViewState) => void
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private readonly debounceMs: number

  constructor(options?: {
    onSnapshot?: (state: PreservedViewState) => void
    debounceMs?: number
  }) {
    this.onSnapshot = options?.onSnapshot
    this.debounceMs = options?.debounceMs ?? 80
  }

  setSnapshotReporter(reporter?: (state: PreservedViewState) => void): void {
    this.onSnapshot = reporter
  }

  // 在收到新 render 指令时合并外壳传回的快照，保留当前会话中已存在的控件值。
  hydrate(incoming?: PreservedViewState): void {
    if (!incoming) return
    this.state = {
      activePage: incoming.activePage ?? this.state.activePage,
      scrollX: incoming.scrollX ?? this.state.scrollX,
      scrollY: incoming.scrollY ?? this.state.scrollY,
      zoom: incoming.zoom ?? this.state.zoom,
      controls: {
        ...(this.state.controls ?? {}),
        ...(incoming.controls ?? {}),
      },
    }
    this.emitListeners()
  }

  getSnapshot = (): PreservedViewState => {
    return this.state
  }

  getControl<T>(key: string, defaultValue: T): T {
    const controls = this.state.controls
    if (controls && Object.hasOwn(controls, key) && controls[key] !== undefined) {
      return controls[key] as T
    }
    return defaultValue
  }

  setControl(key: string, value: unknown): void {
    const prevControls = this.state.controls ?? {}
    if (Object.is(prevControls[key], value)) return
    this.state = {
      ...this.state,
      controls: { ...prevControls, [key]: value },
    }
    this.emitListeners()
    this.scheduleReport()
  }

  setScroll(scrollX: number, scrollY: number): void {
    if (this.state.scrollX === scrollX && this.state.scrollY === scrollY) return
    this.state = {
      ...this.state,
      scrollX,
      scrollY,
    }
    this.scheduleReport()
  }

  setActivePage(activePage: string | undefined): void {
    if (this.state.activePage === activePage) return
    this.state = {
      ...this.state,
      activePage,
    }
    this.emitListeners()
    this.scheduleReport()
  }

  setZoom(zoom: number): void {
    if (zoom <= 0 || this.state.zoom === zoom) return
    this.state = {
      ...this.state,
      zoom,
    }
    this.emitListeners()
    this.scheduleReport()
  }

  // 立即刷新防抖队列，便于测试与卸载前上报最终快照。
  flush(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    this.onSnapshot?.(structuredClone(this.state))
  }

  // 绑定 DOM 内所有带 data-ak-persist 的控件：先按保存值回填，再代理监听后续用户修改。
  bindDomPersistence(rootEl: HTMLElement, scrollTarget?: HTMLElement | Window): () => void {
    const controls = this.state.controls ?? {}
    const persistedNodes = rootEl.querySelectorAll('[data-ak-persist]')
    for (const node of persistedNodes) {
      const key = node.getAttribute('data-ak-persist')?.trim()
      if (!key || !isPersistableElement(node)) continue
      if (Object.hasOwn(controls, key) && controls[key] !== undefined) {
        writeElementValue(node, controls[key])
      }
    }

    const scroller = scrollTarget ?? rootEl
    if (typeof this.state.scrollX === 'number' || typeof this.state.scrollY === 'number') {
      const x = this.state.scrollX ?? 0
      const y = this.state.scrollY ?? 0
      if (isWindowScroller(scroller)) {
        scroller.scrollTo?.(x, y)
      } else {
        scroller.scrollLeft = x
        scroller.scrollTop = y
      }
    }

    const handleControlEvent = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const key = target.getAttribute('data-ak-persist')?.trim()
      if (!key || !isPersistableElement(target)) return
      const value = readElementValue(target)
      if (value !== undefined) {
        this.setControl(key, value)
      }
    }

    const handleScroll = () => {
      if (isWindowScroller(scroller)) {
        this.setScroll(scroller.scrollX, scroller.scrollY)
      } else {
        this.setScroll(scroller.scrollLeft, scroller.scrollTop)
      }
    }

    rootEl.addEventListener('input', handleControlEvent)
    rootEl.addEventListener('change', handleControlEvent)
    scroller.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      rootEl.removeEventListener('input', handleControlEvent)
      rootEl.removeEventListener('change', handleControlEvent)
      scroller.removeEventListener('scroll', handleScroll)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emitListeners(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private scheduleReport(): void {
    if (!this.onSnapshot) return
    if (this.debounceMs <= 0) {
      this.onSnapshot(structuredClone(this.state))
      return
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.onSnapshot?.(structuredClone(this.state))
    }, this.debounceMs)
  }
}

export const defaultPreservedStateManager = new PreservedStateManager()
export const PreservedStateContext = createContext<PreservedStateManager>(
  defaultPreservedStateManager,
)

// 暴露给 React Artifact 的保态控件 Hook：组件重绘后自动恢复用户调整过的数值。
export function usePersistentControl<T>(
  key: string,
  defaultValue: T,
): readonly [T, (next: T | ((prev: T) => T)) => void] {
  const manager = useContext(PreservedStateContext)
  const value = useSyncExternalStore(
    manager.subscribe,
    () => manager.getControl(key, defaultValue),
    () => manager.getControl(key, defaultValue),
  )

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const current = manager.getControl(key, defaultValue)
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(current) : next
      manager.setControl(key, resolved)
    },
    [manager, key, defaultValue],
  )

  return [value, setValue] as const
}
