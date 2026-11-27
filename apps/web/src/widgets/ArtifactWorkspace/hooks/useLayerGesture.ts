import { ARTBOARD_GEOMETRY_LIMITS, type DesignLayer, type VersionSummary } from '@akasha/protocol'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { groupMembers } from '../lib/canvas-arrangement'
import type { Point } from '../lib/canvas-camera'
import { patchHtmlElementGeometry } from '../lib/html-element-geometry'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

/** 图层八向缩放手柄标识。 */
export type LayerResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 图层的直接操控模式：整体移动或手柄缩放。 */
export type LayerGestureMode = 'move' | LayerResizeHandle

/** 可直接拖移和拉伸的 HTML 静态元素上下文。 */
export interface TransformableHtmlElement {
  loc: string
  rect: CanvasBounds
  readFullSource: () => Promise<string | null>
  /** 保存 HTML 几何直改后把当前选区与源码位置平滑延续到新版本，避免松手即丢选区。 */
  onSaved?: (boardId: string, loc: string, nextRect: CanvasBounds, savedVersion: number) => void
}

interface ActiveLayerGesture {
  boardId: string
  scoped: boolean
  targetKey: string
  targetKind: 'design' | 'html'
  designKind?: DesignLayer['kind']
  htmlLoc?: string
  readFullSource?: () => Promise<string | null>
  onHtmlSaved?: TransformableHtmlElement['onSaved']
  mode: LayerGestureMode
  pointerId: number
  handleEl: HTMLElement
  start: Point
  scale: number
  base: VersionSummary
  initial: ReadonlyMap<string, CanvasBounds>
  moved: boolean
  minDelta: Point
  maxDelta: Point
}

/** 拖拽或保存期间的图层实时预览几何。 */
export interface LayerGesturePreview {
  boardId: string
  targetKey: string
  baseVersion: number
  bounds: CanvasBounds
  phase: 'dragging' | 'saving'
}

const MOVE_THRESHOLD = 3

function clampCoord(value: number): number {
  const limit = ARTBOARD_GEOMETRY_LIMITS.coordinate
  return Math.min(limit, Math.max(-limit, Math.round(value)))
}

function clampSize(value: number, min: number): number {
  return Math.min(ARTBOARD_GEOMETRY_LIMITS.viewport, Math.max(min, Math.round(value)))
}

function computeChanges(
  drag: ActiveLayerGesture,
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey'>,
): { primary: CanvasBounds; changes: Array<{ id: string; bounds: CanvasBounds }> } | null {
  const dx = event.clientX - drag.start.x
  const dy = event.clientY - drag.start.y
  if (drag.mode === 'move' && !drag.moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return null
  const deltaX = Math.round(dx / drag.scale)
  const deltaY = Math.round(dy / drag.scale)
  const original = drag.initial.get(drag.targetKey)
  if (!original) return null

  if (drag.mode === 'move') {
    const x = Math.min(drag.maxDelta.x, Math.max(drag.minDelta.x, deltaX))
    const y = Math.min(drag.maxDelta.y, Math.max(drag.minDelta.y, deltaY))
    const changes: Array<{ id: string; bounds: CanvasBounds }> = []
    let primary = original
    for (const [id, box] of drag.initial) {
      const next: CanvasBounds = {
        ...box,
        x: clampCoord(box.x + x),
        y: clampCoord(box.y + y),
      }
      if (id === drag.targetKey) primary = next
      changes.push({ id, bounds: next })
    }
    return { primary, changes }
  }

  const minEdge =
    drag.targetKind === 'design' && (drag.designKind === 'text' || drag.designKind === 'note')
      ? 24
      : 8
  const minW = Math.min(minEdge, original.width)
  const minH = Math.min(minEdge, original.height)
  let left = original.x
  let top = original.y
  let right = original.x + original.width
  let bottom = original.y + original.height

  const hasW = drag.mode.includes('w')
  const hasE = drag.mode.includes('e')
  const hasN = drag.mode.includes('n')
  const hasS = drag.mode.includes('s')

  if (hasW) left = clampCoord(Math.min(right - minW, original.x + deltaX))
  if (hasE) right = Math.max(left + minW, clampCoord(original.x + original.width + deltaX))
  if (hasN) top = clampCoord(Math.min(bottom - minH, original.y + deltaY))
  if (hasS) bottom = Math.max(top + minH, clampCoord(original.y + original.height + deltaY))

  let width = clampSize(right - left, minW)
  let height = clampSize(bottom - top, minH)

  // 四角拖拽按住 Shift 时按原纵横比等比缩放。
  if (
    event.shiftKey &&
    (hasW || hasE) &&
    (hasN || hasS) &&
    original.width > 0 &&
    original.height > 0
  ) {
    const ratio = original.width / original.height
    if (Math.abs(width - original.width) >= Math.abs(height - original.height)) {
      height = clampSize(width / ratio, minH)
    } else {
      width = clampSize(height * ratio, minW)
    }
    if (hasW) left = clampCoord(right - width)
    if (hasN) top = clampCoord(bottom - height)
  } else {
    if (hasW) left = clampCoord(right - width)
    if (hasN) top = clampCoord(bottom - height)
  }

  const primary: CanvasBounds = { x: left, y: top, width, height }
  return { primary, changes: [{ id: drag.targetKey, bounds: primary }] }
}

function sameBounds(a: CanvasBounds, b: CanvasBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/**
 * 原生图层与静态 HTML 元素的画布直接操控手势：拖动移动（原生图层含同组联动）与八向手柄缩放，
 * 过程仅预览不发版，松手以按下时的基准版本原子提交。
 */
export function useLayerGesture(
  editing: CanvasBoardEditing | undefined,
  context: {
    board?: CanvasBoard
    layer?: DesignLayer
    htmlElement?: TransformableHtmlElement
    scale: number
  },
) {
  const active = useRef<ActiveLayerGesture | null>(null)
  const [preview, setPreview] = useState<LayerGesturePreview | null>(null)
  const saving = editing?.busy

  useEffect(() => {
    if (preview?.phase === 'saving' && !saving) setPreview(null)
  }, [preview?.phase, saving])

  const cancel = () => {
    const drag = active.current
    if (!drag) return
    active.current = null
    if (drag.handleEl.hasPointerCapture?.(drag.pointerId)) {
      drag.handleEl.releasePointerCapture(drag.pointerId)
    }
    setPreview(null)
  }

  const begin = (event: PointerEvent<HTMLElement>, mode: LayerGestureMode): boolean => {
    if (event.button !== 0 || event.isPrimary === false || active.current) return false
    const { board, layer, htmlElement, scale } = context
    if (!board || !editing?.available || scale <= 0) return false
    if (!layer && !htmlElement) return false

    const targetKind: 'design' | 'html' = layer ? 'design' : 'html'
    const targetKey = layer ? layer.id : `html:${htmlElement?.loc ?? ''}`
    const initial = new Map<string, CanvasBounds>()
    if (layer) {
      initial.set(layer.id, { x: layer.x, y: layer.y, width: layer.width, height: layer.height })
      if (mode === 'move' && board.designLayers?.length) {
        const ids = new Set(groupMembers(board.designLayers, layer.id))
        for (const item of board.designLayers) {
          if (ids.has(item.id)) {
            initial.set(item.id, { x: item.x, y: item.y, width: item.width, height: item.height })
          }
        }
      }
    } else if (htmlElement) {
      initial.set(targetKey, {
        x: Math.round(htmlElement.rect.x),
        y: Math.round(htmlElement.rect.y),
        width: Math.max(1, Math.round(htmlElement.rect.width)),
        height: Math.max(1, Math.round(htmlElement.rect.height)),
      })
    }

    const { coordinate } = ARTBOARD_GEOMETRY_LIMITS
    const minDelta = { x: -Infinity, y: -Infinity }
    const maxDelta = { x: Infinity, y: Infinity }
    for (const box of initial.values()) {
      minDelta.x = Math.max(minDelta.x, -coordinate - box.x)
      minDelta.y = Math.max(minDelta.y, -coordinate - box.y)
      maxDelta.x = Math.min(maxDelta.x, coordinate - box.x)
      maxDelta.y = Math.min(maxDelta.y, coordinate - box.y)
    }

    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    active.current = {
      boardId: board.id,
      scoped: board.scoped,
      targetKey,
      targetKind,
      designKind: layer?.kind,
      htmlLoc: htmlElement?.loc,
      readFullSource: htmlElement?.readFullSource,
      onHtmlSaved: htmlElement?.onSaved,
      mode,
      pointerId: event.pointerId,
      handleEl: event.currentTarget,
      start: { x: event.clientX, y: event.clientY },
      scale,
      base: editing.version,
      initial,
      moved: false,
      minDelta,
      maxDelta,
    }
    return true
  }

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = active.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    const computed = computeChanges(drag, event)
    if (!computed) return
    drag.moved = true
    setPreview((current) =>
      current &&
      current.phase === 'dragging' &&
      current.targetKey === drag.targetKey &&
      sameBounds(current.bounds, computed.primary)
        ? current
        : {
            boardId: drag.boardId,
            targetKey: drag.targetKey,
            baseVersion: drag.base.version,
            bounds: computed.primary,
            phase: 'dragging',
          },
    )
  }

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = active.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.stopPropagation()
    const computed = computeChanges(drag, event)
    const original = drag.initial.get(drag.targetKey)
    if (!computed || !original || sameBounds(computed.primary, original) || !editing) {
      cancel()
      return
    }
    active.current = null
    setPreview({
      boardId: drag.boardId,
      targetKey: drag.targetKey,
      baseVersion: drag.base.version,
      bounds: computed.primary,
      phase: 'saving',
    })
    if (drag.targetKind === 'design') {
      void editing.change(
        { kind: 'layerGeometry', boardId: drag.boardId, changes: computed.changes },
        drag.base,
      )
      return
    }
    if (!drag.htmlLoc) {
      setPreview(null)
      return
    }
    const dx = computed.primary.x - original.x
    const dy = computed.primary.y - original.y
    const hasHorizontal =
      drag.mode !== 'move' && (drag.mode.includes('e') || drag.mode.includes('w'))
    const hasVertical = drag.mode !== 'move' && (drag.mode.includes('n') || drag.mode.includes('s'))
    const patch = {
      ...(dx !== 0 || dy !== 0 ? { translateDelta: { dx, dy } } : {}),
      ...(hasHorizontal ? { width: computed.primary.width } : {}),
      ...(hasVertical ? { height: computed.primary.height } : {}),
    }
    const nextRect = computed.primary
    const onHtmlSaved = drag.onHtmlSaved
    const boardId = drag.boardId
    const loc = drag.htmlLoc
    const base = drag.base
    if (drag.scoped) {
      void editing.change({ kind: 'htmlElementGeometry', boardId, loc, ...patch }, base, (saved) =>
        onHtmlSaved?.(boardId, loc, nextRect, saved.version),
      )
      return
    }
    void drag.readFullSource?.().then((full) => {
      if (!full) {
        setPreview(null)
        return
      }
      try {
        const nextSource = patchHtmlElementGeometry(full, loc, patch)
        if (nextSource === full) {
          setPreview(null)
          return
        }
        void editing.replaceSource(nextSource, base, (saved) =>
          onHtmlSaved?.(boardId, loc, nextRect, saved.version),
        )
      } catch {
        setPreview(null)
      }
    })
  }

  const onPointerCancel = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerId === active.current?.pointerId) cancel()
  }

  let currentTargetKey: string | undefined
  if (context.layer) currentTargetKey = context.layer.id
  else if (context.htmlElement) currentTargetKey = `html:${context.htmlElement.loc}`

  const activePreview =
    preview &&
    preview.boardId === context.board?.id &&
    preview.targetKey === currentTargetKey &&
    (preview.phase === 'dragging' || (preview.baseVersion === editing?.version.version && saving))
      ? preview
      : null

  return {
    preview: activePreview,
    dragging: activePreview?.phase === 'dragging',
    begin,
    cancel,
    events: {
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
  }
}
