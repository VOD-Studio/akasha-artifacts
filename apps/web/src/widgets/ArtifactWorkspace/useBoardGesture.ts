import { ARTBOARD_GEOMETRY_LIMITS, type Version } from '@akasha/protocol'
import { type PointerEvent, useRef, useState } from 'react'
import type { CanvasBounds, Point } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

interface GestureStart {
  pageId: string
  boardId: string
  original: CanvasBounds
  mode: 'move' | 'resize'
  scale: number
}

interface Gesture extends GestureStart {
  pointerId: number
  handle: HTMLButtonElement
  start: Point
  base: Version
  moved: boolean
}

interface BoardPreview {
  pageId: string
  boardId: string
  baseVersion: number
  bounds: CanvasBounds
  phase: 'dragging' | 'saving'
}

type HandleEvent = PointerEvent<HTMLButtonElement>

function atPointer(
  drag: Gesture,
  event: Pick<HandleEvent, 'clientX' | 'clientY'>,
): CanvasBounds | undefined {
  const dx = event.clientX - drag.start.x
  const dy = event.clientY - drag.start.y
  if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return undefined
  const deltaX = Math.round(dx / drag.scale)
  const deltaY = Math.round(dy / drag.scale)
  const { coordinate, viewport } = ARTBOARD_GEOMETRY_LIMITS
  const { original } = drag
  if (drag.mode === 'move') {
    return {
      ...original,
      x: Math.min(coordinate, Math.max(-coordinate, original.x + deltaX)),
      y: Math.min(coordinate, Math.max(-coordinate, original.y + deltaY)),
    }
  }
  return {
    ...original,
    width: Math.max(1, Math.min(viewport, original.width + deltaX)),
    height: Math.max(1, Math.min(viewport, original.height + deltaY)),
  }
}

function sameBounds(a: CanvasBounds, b: CanvasBounds) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** 按手势开始时的相机换算坐标，进行中从不发布；松手后沿用抓取时的版本。 */
export function useBoardGesture(
  editing: CanvasBoardEditing | undefined,
  onMoving: (boardId: string) => void,
) {
  const active = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<BoardPreview | null>(null)

  function show(drag: Gesture, bounds: CanvasBounds, phase: BoardPreview['phase']) {
    setPreview((current) =>
      current &&
      current.phase === phase &&
      current.boardId === drag.boardId &&
      sameBounds(current.bounds, bounds)
        ? current
        : {
            pageId: drag.pageId,
            boardId: drag.boardId,
            baseVersion: drag.base.version,
            phase,
            bounds,
          },
    )
  }

  function cancel() {
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
      (preview.phase === 'dragging' ||
        (preview.baseVersion === editing?.version.version && editing.draft?.status === 'saving'))
        ? preview
        : null,
    begin(event: HandleEvent, start: GestureStart) {
      if (!editing?.available || active.current || event.button !== 0 || event.isPrimary === false)
        return
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      active.current = {
        ...start,
        pointerId: event.pointerId,
        handle: event.currentTarget,
        start: { x: event.clientX, y: event.clientY },
        base: editing.version,
        moved: false,
      }
    },
    cancel,
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
        if (!bounds || sameBounds(bounds, drag.original) || !editing) {
          cancel()
          return
        }
        active.current = null
        show(drag, bounds, 'saving')
        editing.change({ kind: 'geometry', changes: [{ id: drag.boardId, bounds }] }, drag.base)
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
