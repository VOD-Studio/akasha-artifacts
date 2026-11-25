import { type RefObject, useEffect, useEffectEvent, useState } from 'react'
import { acceptsCanvasShortcut } from '../lib/canvas-keyboard'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

const KEYBOARD_CONTROL =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]'

interface CanvasShortcutOptions {
  visible: boolean
  viewportRef: RefObject<HTMLElement | null>
  navigatorOpen: boolean
  closePresentation?: () => void
  historyEditing?: CanvasBoardEditing
  cancelGesture: () => void
  clearSelection: () => void
}

/** 播放或展开时 Esc 交还给展示层；总览快捷键只处理画布范围内的事件。 */
export function useCanvasShortcuts({
  visible,
  viewportRef,
  navigatorOpen,
  closePresentation,
  historyEditing,
  cancelGesture,
  clearSelection,
}: CanvasShortcutOptions) {
  const [space, setSpace] = useState(false)
  const [modifier, setModifier] = useState(false)
  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || navigatorOpen) return
    if (closePresentation) {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        closePresentation()
      }
      return
    }
    if (!acceptsCanvasShortcut(event, viewportRef.current?.parentElement)) return
    const target = event.target instanceof Element ? event.target : null
    const editing = target?.closest(KEYBOARD_CONTROL)
    if (
      historyEditing &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 'z'
    ) {
      const action = event.shiftKey ? historyEditing.redo : historyEditing.undo
      if (action) {
        cancelGesture()
        event.preventDefault()
        action()
      }
      return
    }
    if (event.code === 'Space' && !editing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      setSpace(true)
    }
    if (event.key === 'Control' || event.key === 'Meta') setModifier(true)
    if (event.key !== 'Escape') return
    cancelGesture()
    setSpace(false)
    clearSelection()
  })

  useEffect(() => {
    if (!visible) return
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false)
      if (event.key === 'Control' || event.key === 'Meta')
        setModifier(event.ctrlKey || event.metaKey)
    }
    const blur = () => {
      setSpace(false)
      setModifier(false)
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [visible])

  const resetModifiers = () => {
    setSpace(false)
    setModifier(false)
  }
  return { space, modifier, resetModifiers }
}
