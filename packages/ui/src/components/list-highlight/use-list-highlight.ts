'use client'

import { type RefCallback, useCallback, useRef } from 'react'

const ITEM_SELECTOR = '[data-list-highlight-item]'
const OWNER_SELECTOR = '[data-list-highlight]'
const DISABLED_SELECTOR = ":disabled, [aria-disabled='true'], [data-disabled]"
const SELECTED_SELECTOR = '[data-list-highlight-active="true"], [data-state="open"]'
const HIGHLIGHT_VARS = ['x', 'y', 'width', 'height', 'radius'] as const

const MUTATION_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    'disabled',
    'aria-disabled',
    'data-disabled',
    'data-list-highlight-active',
    'data-state',
    'class',
  ],
}

export type ListHighlightMode = 'pointer' | 'focus' | 'active'

type PointerZone = 'outside' | 'inside' | 'disabled'

interface HighlightOptions {
  mode?: ListHighlightMode
  /** Dropdown 的安全区统一判断真正离开，由 clearPointer 清除悬停目标。 */
  manualPointerLeave?: boolean
}

export function isKeyboardFocus(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

function findOwnItem(root: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const item = target.closest<HTMLElement>(ITEM_SELECTOR)
  return item && item.closest(OWNER_SELECTOR) === root ? item : null
}

function isEnabledItem(root: HTMLElement, item: HTMLElement | null): item is HTMLElement {
  return (
    item !== null &&
    root.contains(item) &&
    item.closest(OWNER_SELECTOR) === root &&
    !item.matches(DISABLED_SELECTOR)
  )
}

function findSelectedItem(root: HTMLElement): HTMLElement | null {
  for (const item of root.querySelectorAll<HTMLElement>(SELECTED_SELECTOR)) {
    if (item.matches(ITEM_SELECTOR) && isEnabledItem(root, item)) return item
  }
  return null
}

function resolveFocusedItem(
  root: HTMLElement,
  target: EventTarget | null,
  mode: ListHighlightMode,
): HTMLElement | null {
  if (mode === 'active') return null
  const item = findOwnItem(root, target)
  if (!isEnabledItem(root, item)) return null
  return mode === 'focus' || isKeyboardFocus(item) ? item : null
}

function applyHighlightRect(root: HTMLElement, item: HTMLElement): void {
  const rect = item.getBoundingClientRect()
  const origin = root.getBoundingClientRect()
  // 包围盒可能包含浮层或缩放变换，底色坐标仍按容器自身 CSS 像素换算。
  const scaleX = (root.offsetWidth && origin.width / root.offsetWidth) || 1
  const scaleY = (root.offsetHeight && origin.height / root.offsetHeight) || 1
  const x = (rect.left - origin.left) / scaleX - root.clientLeft + root.scrollLeft
  const y = (rect.top - origin.top) / scaleY - root.clientTop + root.scrollTop
  root.style.setProperty('--v-list-hl-x', `${x}px`)
  root.style.setProperty('--v-list-hl-y', `${y}px`)
  root.style.setProperty('--v-list-hl-width', `${rect.width / scaleX}px`)
  root.style.setProperty('--v-list-hl-height', `${rect.height / scaleY}px`)
  root.style.setProperty('--v-list-hl-radius', getComputedStyle(item).borderRadius)
}

function clearHighlightStyles(root: HTMLElement): void {
  root.removeAttribute('data-list-highlight-visible')
  root.removeAttribute('data-list-highlight-jump')
  for (const key of HIGHLIGHT_VARS) {
    root.style.removeProperty(`--v-list-hl-${key}`)
  }
}

function attachListHighlight(
  root: HTMLElement,
  { mode = 'pointer', manualPointerLeave = false }: HighlightOptions,
) {
  root.setAttribute('data-list-highlight', '')

  let hovered: HTMLElement | null = null
  let focused = resolveFocusedItem(root, document.activeElement, mode)
  let active: HTMLElement | null = null
  let pointerZone: PointerZone = 'outside'
  let focusInRoot = document.activeElement !== null && root.contains(document.activeElement)
  let clearFrame = 0

  const cancelClear = () => {
    if (!clearFrame) return
    cancelAnimationFrame(clearFrame)
    clearFrame = 0
  }

  const measureActive = () => {
    if (isEnabledItem(root, active)) applyHighlightRect(root, active)
  }

  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureActive)

  const setActive = (next: HTMLElement | null) => {
    cancelClear()
    if (next === active) return

    const teleport = active === null || !root.contains(active)
    if (active) {
      resize?.unobserve(active)
      if (mode === 'pointer') active.removeAttribute('data-highlighted')
    }
    active = next

    if (!active) {
      root.setAttribute('data-list-highlight-visible', 'false')
      return
    }

    if (mode === 'pointer') active.setAttribute('data-highlighted', '')
    resize?.observe(active)

    if (teleport) {
      // 隐藏态首次出现先无过渡落位并强制提交样式，再恢复滑动过渡并淡入，避免首帧飞入或首次移动硬跳。
      root.setAttribute('data-list-highlight-jump', 'true')
      applyHighlightRect(root, active)
      void root.offsetWidth
      root.removeAttribute('data-list-highlight-jump')
    } else {
      applyHighlightRect(root, active)
    }
    root.setAttribute('data-list-highlight-visible', 'true')
  }

  const sync = (deferClear = true): boolean => {
    if (!isEnabledItem(root, hovered)) hovered = null
    if (!isEnabledItem(root, focused)) focused = null

    const next = hovered ?? focused ?? findSelectedItem(root)
    if (next) {
      const changed = next !== active
      setActive(next)
      return changed
    }

    // Radix 菜单里指针经过条目间隙、分隔线或分组标题时会短暂把焦点交还面板容器；
    // 只要指针仍在面板内且未停在禁用项上，就保留原高亮作为滑动起点。
    if (
      mode === 'focus' &&
      pointerZone === 'inside' &&
      focusInRoot &&
      isEnabledItem(root, active)
    ) {
      cancelClear()
      return false
    }

    // 键盘换项若同帧先把焦点交还容器，延后一帧确认是否被新项接管。
    if (mode === 'focus' && deferClear && pointerZone === 'outside' && focusInRoot && active) {
      if (!clearFrame) {
        clearFrame = requestAnimationFrame(() => {
          clearFrame = 0
          sync(false)
        })
      }
      return false
    }

    const changed = active !== null
    setActive(null)
    return changed
  }

  const handlePointerEnter = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (pointerZone === 'outside') pointerZone = 'inside'
  }

  const handlePointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.defaultPrevented) return
    const item = findOwnItem(root, event.target)
    const nextZone: PointerZone = item && !isEnabledItem(root, item) ? 'disabled' : 'inside'

    if (mode === 'focus') {
      const zoneChanged = nextZone !== pointerZone
      pointerZone = nextZone
      if (zoneChanged && nextZone === 'disabled') sync(false)
      return
    }

    pointerZone = nextZone
    if (mode !== 'pointer') return
    if (item && item === hovered && isEnabledItem(root, hovered)) return
    // 条目间隙保留上一个悬停项，避免跨间隙闪烁。
    if (!item) return
    hovered = isEnabledItem(root, item) ? item : null
    sync(false)
  }

  const handlePointerLeave = () => {
    pointerZone = 'outside'
    hovered = null
    sync(false)
  }

  const handleFocusIn = (event: FocusEvent) => {
    focusInRoot = true
    focused = resolveFocusedItem(root, event.target, mode)
    if (focused) hovered = null
    sync(true)
  }

  const handleFocusOut = (event: FocusEvent) => {
    focusInRoot = event.relatedTarget instanceof Node && root.contains(event.relatedTarget)
    focused = resolveFocusedItem(root, event.relatedTarget, mode)
    sync(true)
  }

  const mutations = new MutationObserver(() => {
    if (!sync(false)) measureActive()
  })

  sync(false)
  resize?.observe(root)
  mutations.observe(root, MUTATION_OPTIONS)
  root.addEventListener('pointerenter', handlePointerEnter)
  root.addEventListener('pointerover', handlePointer)
  root.addEventListener('pointermove', handlePointer)
  if (!manualPointerLeave) root.addEventListener('pointerleave', handlePointerLeave)
  root.addEventListener('focusin', handleFocusIn)
  root.addEventListener('focusout', handleFocusOut)

  return {
    clearPointer: handlePointerLeave,
    detach: () => {
      cancelClear()
      resize?.disconnect()
      mutations.disconnect()
      if (mode === 'pointer') active?.removeAttribute('data-highlighted')
      root.removeEventListener('pointerenter', handlePointerEnter)
      root.removeEventListener('pointerover', handlePointer)
      root.removeEventListener('pointermove', handlePointer)
      root.removeEventListener('pointerleave', handlePointerLeave)
      root.removeEventListener('focusin', handleFocusIn)
      root.removeEventListener('focusout', handleFocusOut)
      clearHighlightStyles(root)
    },
  }
}

export function useListHighlight<T extends HTMLElement = HTMLElement>({
  mode = 'pointer',
  manualPointerLeave = false,
}: HighlightOptions = {}) {
  const clearRef = useRef<(() => void) | null>(null)
  const clearPointer = useCallback(() => clearRef.current?.(), [])
  const ref: RefCallback<T> = useCallback(
    (root) => {
      if (!root) return
      const controller = attachListHighlight(root, { mode, manualPointerLeave })
      clearRef.current = controller.clearPointer
      return () => {
        if (clearRef.current === controller.clearPointer) clearRef.current = null
        controller.detach()
      }
    },
    [mode, manualPointerLeave],
  )
  return { ref, clearPointer }
}
