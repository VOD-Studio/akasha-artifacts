import { ARTBOARD_GEOMETRY_LIMITS, type VersionSummary } from '@akasha/protocol'
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react'
import type { CanvasBounds, CanvasPage } from '@/entities/artifact'
import { groupMembers } from '../lib/canvas-arrangement'
import type { Point } from '../lib/canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface GestureStart {
  pageId: string
  boardId: string
  initial: ReadonlyMap<string, CanvasBounds>
  mode: 'move' | 'resize'
  scale: number
}

interface Gesture extends GestureStart {
  pointerId: number
  handle: HTMLButtonElement
  start: Point
  base: VersionSummary
  moved: boolean
  minDelta: Point
  maxDelta: Point
}

interface BoardPreview {
  pageId: string
  baseVersion: number
  bounds: ReadonlyMap<string, CanvasBounds>
  phase: 'dragging' | 'saving'
}

type HandleEvent = PointerEvent<HTMLButtonElement>

function atPointer(
  drag: Gesture,
  event: Pick<HandleEvent, 'clientX' | 'clientY'>,
): ReadonlyMap<string, CanvasBounds> | undefined {
  const dx = event.clientX - drag.start.x
  const dy = event.clientY - drag.start.y
  if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return undefined
  const deltaX = Math.round(dx / drag.scale)
  const deltaY = Math.round(dy / drag.scale)
  const { viewport } = ARTBOARD_GEOMETRY_LIMITS
  if (drag.mode === 'move') {
    const x = Math.min(drag.maxDelta.x, Math.max(drag.minDelta.x, deltaX))
    const y = Math.min(drag.maxDelta.y, Math.max(drag.minDelta.y, deltaY))
    const boxes = new Map<string, CanvasBounds>()
    for (const [id, original] of drag.initial) {
      boxes.set(id, { ...original, x: original.x + x, y: original.y + y })
    }
    return boxes
  }
  const original = drag.initial.get(drag.boardId)
  if (!original) return undefined
  return new Map([
    [
      drag.boardId,
      {
        ...original,
        width: Math.max(1, Math.min(viewport, original.width + deltaX)),
        height: Math.max(1, Math.min(viewport, original.height + deltaY)),
      },
    ],
  ])
}

function sameBounds(a: ReadonlyMap<string, CanvasBounds>, b: ReadonlyMap<string, CanvasBounds>) {
  if (a.size !== b.size) return false
  for (const [id, box] of a) {
    const other = b.get(id)
    if (
      !other ||
      box.x !== other.x ||
      box.y !== other.y ||
      box.width !== other.width ||
      box.height !== other.height
    )
      return false
  }
  return true
}

/** 按手势开始时的相机换算坐标，进行中从不发布；松手后沿用抓取时的版本。 */
export function useBoardGesture(
  editing: CanvasBoardEditing | undefined,
  layout: {
    page?: CanvasPage
    bounds: ReadonlyMap<string, CanvasBounds>
    selection: ReadonlySet<string>
    scale: number
  },
  onMoving: (boardId: string) => void,
) {
  const active = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<BoardPreview | null>(null)
  const draggedTitle = useRef<HTMLButtonElement | null>(null)
  const saving = editing?.busy
  useEffect(() => {
    if (preview?.phase === 'saving' && !saving) setPreview(null)
  }, [preview?.phase, saving])

  const show = (drag: Gesture, bounds: BoardPreview['bounds'], phase: BoardPreview['phase']) => {
    setPreview((current) =>
      current &&
      current.phase === phase &&
      current.pageId === drag.pageId &&
      sameBounds(current.bounds, bounds)
        ? current
        : {
            pageId: drag.pageId,
            baseVersion: drag.base.version,
            phase,
            bounds,
          },
    )
  }

  const cancel = () => {
    const drag = active.current
    if (!drag) return
    active.current = null
    if (drag.handle.hasPointerCapture?.(drag.pointerId))
      drag.handle.releasePointerCapture(drag.pointerId)
    setPreview(null)
  }

  return {
    preview:
      preview &&
      (preview.phase === 'dragging' || (preview.baseVersion === editing?.version.version && saving))
        ? preview
        : null,
    begin(event: HandleEvent, boardId: string, bounds: CanvasBounds, mode: GestureStart['mode']) {
      draggedTitle.current = null
      if (
        !layout.page ||
        !editing?.available ||
        active.current ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return
      const initial = new Map([[boardId, bounds]])
      if (mode === 'move') {
        const ids = layout.selection.has(boardId)
          ? layout.selection
          : groupMembers(layout.page.boards, boardId)
        for (const id of ids) {
          const included = layout.bounds.get(id)
          if (included) initial.set(id, included)
        }
      }
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      const { coordinate } = ARTBOARD_GEOMETRY_LIMITS
      const minDelta = { x: -Infinity, y: -Infinity }
      const maxDelta = { x: Infinity, y: Infinity }
      for (const bounds of initial.values()) {
        minDelta.x = Math.max(minDelta.x, -coordinate - bounds.x)
        minDelta.y = Math.max(minDelta.y, -coordinate - bounds.y)
        maxDelta.x = Math.min(maxDelta.x, coordinate - bounds.x)
        maxDelta.y = Math.min(maxDelta.y, coordinate - bounds.y)
      }
      active.current = {
        pageId: layout.page.id,
        boardId,
        initial,
        mode,
        scale: layout.scale,
        pointerId: event.pointerId,
        handle: event.currentTarget,
        start: { x: event.clientX, y: event.clientY },
        base: editing.version,
        moved: false,
        minDelta,
        maxDelta,
      }
    },
    cancel,
    consumesClick(event: MouseEvent<HTMLButtonElement>) {
      if (!event.detail || draggedTitle.current !== event.currentTarget) return false
      draggedTitle.current = null
      return true
    },
    events: {
      onPointerMove(event: HandleEvent) {
        const drag = active.current
        if (!drag || event.pointerId !== drag.pointerId) return
        const bounds = atPointer(drag, event)
        if (!bounds) return
        if (!drag.moved) {
          drag.moved = true
          onMoving(drag.boardId)
        }
        show(drag, bounds, 'dragging')
      },
      onPointerUp(event: HandleEvent) {
        const drag = active.current
        if (!drag || event.pointerId !== drag.pointerId) return
        const bounds = atPointer(drag, event)
        if (bounds && drag.mode === 'move') draggedTitle.current = event.currentTarget
        if (!bounds || sameBounds(bounds, drag.initial) || !editing) {
          cancel()
          return
        }
        active.current = null
        show(drag, bounds, 'saving')
        editing.change(
          { kind: 'geometry', changes: Array.from(bounds, ([id, bounds]) => ({ id, bounds })) },
          drag.base,
        )
      },
      onPointerCancel(event: HandleEvent) {
        if (event.pointerId === active.current?.pointerId) cancel()
      },
      onLostPointerCapture(event: HandleEvent) {
        if (event.pointerId === active.current?.pointerId) cancel()
      },
    },
  }
}
