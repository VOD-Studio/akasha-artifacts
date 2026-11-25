import {
  ARTBOARD_GEOMETRY_LIMITS,
  type CanvasLayer,
  type DesignLayer,
  type EditOp,
} from '@akasha/protocol'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
} from 'react'
import type { CanvasBoard, CanvasBounds, CanvasPage } from '@/entities/artifact'
import type { VisualEditTarget } from '@/features/visual-edit'
import { groupMembers } from '../lib/canvas-arrangement'
import {
  type CanvasClipboardEntry,
  materializePastedBoards,
  materializePastedLayers,
  snapshotBoardsForClipboard,
} from '../lib/canvas-clipboard'
import { acceptsCanvasShortcut } from '../lib/canvas-keyboard'
import { firstChildLayer, nextSiblingLayer, parentLayer } from '../lib/canvas-layer-navigation'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface KeyboardEditingOptions {
  visible: boolean
  viewportRef: RefObject<HTMLElement | null>
  layerFocusRef: RefObject<HTMLButtonElement | null>
  selectionToolbarRef: RefObject<HTMLElement | null>
  page?: CanvasPage
  selectedBoards: readonly CanvasBoard[]
  boardBounds: ReadonlyMap<string, CanvasBounds>
  activeBoard?: CanvasBoard
  layers: readonly CanvasLayer[]
  selectedLayer?: CanvasLayer
  selectedDesignLayer?: DesignLayer
  visualTarget: VisualEditTarget | null
  editing?: CanvasBoardEditing
  canEditBoards: boolean
  versionNumber: number
  readFullSource: () => Promise<string | null>
  onSelectLayer: (layer: CanvasLayer | null, shouldReveal?: boolean) => void
  onSelectBoard: (boardId: string | null) => void
  onApplyRuntimeOp: (op: EditOp) => Promise<boolean>
}

function hasTextSelection(): boolean {
  return Boolean(window.getSelection?.()?.toString())
}

function clampCoord(value: number): number {
  const limit = ARTBOARD_GEOMETRY_LIMITS.coordinate
  return Math.min(limit, Math.max(-limit, Math.round(value)))
}

/**
 * 画布键盘图层遍历与编辑编排：处理 Return/Tab/Shift+Return/Esc 层级导航、自由层微调、流内层重排、
 * 剪贴板复制粘贴、翻转、成组/解组、删除与 F6 浮栏跳转。
 */
export function useCanvasKeyboardEditing({
  visible,
  viewportRef,
  layerFocusRef,
  selectionToolbarRef,
  page,
  selectedBoards,
  boardBounds,
  activeBoard,
  layers,
  selectedLayer,
  selectedDesignLayer,
  visualTarget,
  editing,
  canEditBoards,
  versionNumber,
  readFullSource,
  onSelectLayer,
  onSelectBoard,
  onApplyRuntimeOp,
}: KeyboardEditingOptions) {
  const clipboard = useRef<CanvasClipboardEntry | null>(null)

  const focusBoardTitle = (boardId?: string) => {
    if (!boardId || !viewportRef.current) return
    for (const target of viewportRef.current.querySelectorAll<HTMLButtonElement>(
      '.artifact-canvas-board-title',
    )) {
      if (target.dataset.boardId === boardId) {
        target.focus({ preventScroll: true })
        break
      }
    }
  }

  const focusLayerTarget = () => {
    layerFocusRef.current?.focus({ preventScroll: true })
  }

  const focusSelectionToolbar = (): boolean => {
    const toolbar = selectionToolbarRef.current
    if (!toolbar) return false
    const first = toolbar.querySelector<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )
    if (first) {
      first.focus({ preventScroll: true })
      return true
    }
    toolbar.focus({ preventScroll: true })
    return true
  }

  const selectedNativeGroup = (): DesignLayer[] => {
    if (!activeBoard?.designLayers || !selectedDesignLayer) return []
    const ids = new Set(groupMembers(activeBoard.designLayers, selectedDesignLayer.id))
    return activeBoard.designLayers.filter((item) => ids.has(item.id))
  }

  const copySelection = async (): Promise<boolean> => {
    const native = selectedNativeGroup()
    if (native.length && activeBoard) {
      clipboard.current = {
        kind: 'layers',
        sourceBoardId: activeBoard.id,
        layers: native.map((layer) => structuredClone(layer)),
        pasteCount: 0,
      }
      return true
    }
    if (selectedBoards.length && page) {
      const source = await readFullSource()
      if (!source) return false
      const snap = snapshotBoardsForClipboard(
        source,
        versionNumber,
        page.id,
        selectedBoards.map((board) => board.id),
        boardBounds,
      )
      if (!snap) return false
      clipboard.current = snap
      return true
    }
    return false
  }

  const deleteSelection = () => {
    if (!canEditBoards || !editing?.available) return false
    const native = selectedNativeGroup()
    if (native.length && activeBoard) {
      const ids = native.map((layer) => layer.id)
      onSelectLayer(null)
      focusBoardTitle(activeBoard.id)
      void editing.change({ kind: 'layerDeleteMany', boardId: activeBoard.id, layerIds: ids })
      return true
    }
    if (selectedLayer?.sourceLoc && visualTarget && activeBoard) {
      onSelectLayer(null)
      focusBoardTitle(activeBoard.id)
      void onApplyRuntimeOp({ kind: 'remove', loc: selectedLayer.sourceLoc })
      return true
    }
    if (selectedBoards.length) {
      const ids = selectedBoards.map((board) => board.id)
      onSelectBoard(null)
      void editing.change({ kind: 'delete', ids })
      return true
    }
    return false
  }

  const pasteSelection = () => {
    const entry = clipboard.current
    if (!entry || !canEditBoards || !editing?.available) return false
    if (entry.kind === 'layers' && activeBoard) {
      const next = materializePastedLayers(entry, activeBoard.id)
      entry.pasteCount += 1
      void editing.change({ kind: 'layerPaste', boardId: activeBoard.id, layers: next })
      return true
    }
    if (entry.kind === 'boards' && page) {
      const next = materializePastedBoards(entry, page.id)
      entry.pasteCount += 1
      void editing.change({ kind: 'pasteBoards', pageId: page.id, boards: next }).then((ok) => {
        if (ok && next[0]) onSelectBoard(next[0].id)
      })
      return true
    }
    return false
  }

  const duplicateSelection = () => {
    if (!canEditBoards || !editing?.available) return false
    if (selectedDesignLayer && activeBoard) {
      void editing.change({
        kind: 'layerDuplicate',
        boardId: activeBoard.id,
        layerId: selectedDesignLayer.id,
        id: crypto.randomUUID(),
      })
      return true
    }
    if (selectedBoards.length === 1) {
      const board = selectedBoards[0]
      const box = boardBounds.get(board.id)
      if (!box) return false
      const id = crypto.randomUUID()
      void editing
        .change({
          kind: 'duplicate',
          boardId: board.id,
          id,
          bounds: { ...box, x: clampCoord(box.x + 48), y: clampCoord(box.y + 48) },
        })
        .then((ok) => {
          if (ok) onSelectBoard(id)
        })
      return true
    }
    return false
  }

  const flipSelection = (axis: 'horizontal' | 'vertical') => {
    if (!canEditBoards || !editing?.available) return false
    const native = selectedNativeGroup()
    if (native.length && activeBoard) {
      void editing.change({
        kind: 'layerFlip',
        boardId: activeBoard.id,
        layerIds: native.map((item) => item.id),
        axis,
      })
      return true
    }
    if (selectedBoards.length > 1) {
      void editing.change({
        kind: 'boardFlip',
        ids: selectedBoards.map((board) => board.id),
        bounds: boardBounds,
        axis,
      })
      return true
    }
    return false
  }

  const reorderSelectedFlow = (delta: -1 | 1): boolean => {
    if (!canEditBoards || !editing?.available) return false
    if (selectedDesignLayer && activeBoard) {
      void editing.change({
        kind: 'layerReorder',
        boardId: activeBoard.id,
        layerId: selectedDesignLayer.id,
        delta,
      })
      return true
    }
    if (selectedLayer?.sourceLoc && visualTarget?.order) {
      const siblings = visualTarget.order.siblings
      const index = siblings.findIndex((item) => item.loc === selectedLayer.sourceLoc)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return false
      void onApplyRuntimeOp({
        kind: 'move',
        loc: selectedLayer.sourceLoc,
        targetParentLoc: visualTarget.order.parentLoc,
        index: nextIndex,
      })
      return true
    }
    return false
  }

  const onLayerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!selectedLayer || !activeBoard || event.nativeEvent.isComposing) return
    const { key } = event
    if (key === 'F6' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (focusSelectionToolbar()) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onSelectLayer(null)
      focusBoardTitle(activeBoard.id)
      return
    }
    if (key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const next = nextSiblingLayer(layers, selectedLayer.id, event.shiftKey ? -1 : 1)
      if (next) {
        event.preventDefault()
        event.stopPropagation()
        onSelectLayer(next, false)
      }
      return
    }
    if (key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) {
        const parent = parentLayer(layers, selectedLayer.id)
        if (parent) {
          onSelectLayer(parent, false)
        } else {
          onSelectLayer(null)
          focusBoardTitle(activeBoard.id)
        }
        return
      }
      const child = firstChildLayer(layers, selectedLayer.id)
      if (child) onSelectLayer(child, false)
      return
    }
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
      if (event.ctrlKey || event.metaKey) return
      if (event.altKey) {
        const delta = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1
        if (reorderSelectedFlow(delta)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
      const native = selectedNativeGroup()
      if (native.length && canEditBoards && editing?.available) {
        event.preventDefault()
        event.stopPropagation()
        const step = event.shiftKey ? 10 : 1
        let dx = 0
        if (key === 'ArrowLeft') dx = -step
        else if (key === 'ArrowRight') dx = step
        let dy = 0
        if (key === 'ArrowUp') dy = -step
        else if (key === 'ArrowDown') dy = step
        const changes = native.map((layer) => ({
          id: layer.id,
          bounds: {
            x: clampCoord(layer.x + dx),
            y: clampCoord(layer.y + dy),
            width: layer.width,
            height: layer.height,
          },
        }))
        void editing.change({ kind: 'layerGeometry', boardId: activeBoard.id, changes })
        return
      }
      const dir = key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1
      const next = nextSiblingLayer(layers, selectedLayer.id, dir)
      if (next) {
        event.preventDefault()
        event.stopPropagation()
        onSelectLayer(next, false)
      }
    }
  }

  const handleGlobalKey = useEffectEvent((event: KeyboardEvent) => {
    const shell = viewportRef.current?.parentElement
    if (!acceptsCanvasShortcut(event, shell)) return
    const target = event.target instanceof Element ? event.target : null
    if (selectionToolbarRef.current?.contains(target)) return
    const mod = event.ctrlKey || event.metaKey
    const key = /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase()

    if (event.key === 'F6' && !mod && !event.altKey) {
      if (focusSelectionToolbar()) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && !mod && !event.altKey) {
      if (deleteSelection()) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if (!mod && !event.altKey && event.shiftKey && (key === 'h' || key === 'v')) {
      if (flipSelection(key === 'h' ? 'horizontal' : 'vertical')) {
        event.preventDefault()
        event.stopPropagation()
      }
      return
    }

    if (mod && !event.altKey) {
      if (key === 'c' && !event.shiftKey && !hasTextSelection()) {
        event.preventDefault()
        void copySelection()
        return
      }
      if (key === 'x' && !event.shiftKey && !hasTextSelection()) {
        event.preventDefault()
        void copySelection().then((copied) => {
          if (copied) deleteSelection()
        })
        return
      }
      if (key === 'v' && !event.shiftKey && clipboard.current) {
        if (pasteSelection()) event.preventDefault()
        return
      }
      if (key === 'd' && !event.shiftKey) {
        if (duplicateSelection()) event.preventDefault()
        return
      }
      if (key === 'g' && canEditBoards && editing?.available) {
        if (event.shiftKey) {
          const native = selectedNativeGroup().filter((item) => item.layoutGroup)
          if (native.length && activeBoard) {
            event.preventDefault()
            void editing.change({
              kind: 'layerGroup',
              boardId: activeBoard.id,
              ids: native.map((item) => item.id),
              layoutGroup: null,
            })
            return
          }
          const groupedBoards = selectedBoards.filter((board) => board.layoutGroup)
          if (groupedBoards.length) {
            event.preventDefault()
            void editing.change({
              kind: 'group',
              ids: groupedBoards.map((board) => board.id),
              layoutGroup: null,
            })
            return
          }
        } else if (selectedBoards.length > 1 && !selectedLayer) {
          event.preventDefault()
          void editing.change({
            kind: 'group',
            ids: selectedBoards.map((board) => board.id),
            layoutGroup: crypto.randomUUID(),
          })
          return
        }
      }
    }
  })

  useEffect(() => {
    if (!visible) return
    window.addEventListener('keydown', handleGlobalKey)
    return () => window.removeEventListener('keydown', handleGlobalKey)
  }, [visible])

  return {
    onLayerKeyDown,
    focusBoardTitle,
    focusLayerTarget,
    focusSelectionToolbar,
    reorderSelectedFlow,
    flipSelection,
    deleteSelection,
  }
}
