import { type PointerEvent, useRef, useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import type { Camera, Point } from '../lib/canvas-camera'
import { boardsIntersectingRect } from '../lib/canvas-layer-navigation'

interface MarqueeOptions {
  enabled: boolean
  boards: readonly CanvasBoard[]
  bounds: ReadonlyMap<string, CanvasBounds>
  camera: Camera
  onCommit: (boardIds: readonly string[], additive: boolean) => void
}

interface ActiveDrag {
  pointerId: number
  start: Point
  rect: DOMRect
  additive: boolean
  moved: boolean
}

const DRAG_THRESHOLD = 4

function normalizeBox(start: Point, end: Point): CanvasBounds {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  return { x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

/** 空白处拖框选中多张画板；不足拖动阈值时交还给点击清空逻辑。 */
export function useCanvasMarquee({ enabled, boards, bounds, camera, onCommit }: MarqueeOptions) {
  const drag = useRef<ActiveDrag | null>(null)
  const consumedClick = useRef(false)
  const [box, setBox] = useState<CanvasBounds | null>(null)
  const [previewIds, setPreviewIds] = useState<ReadonlySet<string>>(() => new Set())

  const toCanvasRect = (viewportBox: CanvasBounds): CanvasBounds => ({
    x: (viewportBox.x - camera.x) / camera.scale,
    y: (viewportBox.y - camera.y) / camera.scale,
    width: viewportBox.width / camera.scale,
    height: viewportBox.height / camera.scale,
  })

  const cancel = () => {
    drag.current = null
    setBox(null)
    setPreviewIds(new Set())
  }

  return {
    box,
    previewIds,
    active: box !== null,
    cancel,
    consumeBackgroundClick() {
      if (!consumedClick.current) return false
      consumedClick.current = false
      return true
    },
    onPointerDown(event: PointerEvent<HTMLElement>) {
      consumedClick.current = false
      if (
        !enabled ||
        event.button !== 0 ||
        event.isPrimary === false ||
        event.target !== event.currentTarget
      )
        return false
      const rect = event.currentTarget.getBoundingClientRect()
      const start = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      drag.current = {
        pointerId: event.pointerId,
        start,
        rect,
        additive: event.shiftKey,
        moved: false,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      return true
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return false
      const point = { x: event.clientX - current.rect.left, y: event.clientY - current.rect.top }
      if (
        !current.moved &&
        Math.hypot(point.x - current.start.x, point.y - current.start.y) < DRAG_THRESHOLD
      ) {
        return true
      }
      current.moved = true
      const viewportBox = normalizeBox(current.start, point)
      setBox(viewportBox)
      setPreviewIds(new Set(boardsIntersectingRect(boards, bounds, toCanvasRect(viewportBox))))
      return true
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return false
      const point = { x: event.clientX - current.rect.left, y: event.clientY - current.rect.top }
      const moved =
        current.moved ||
        Math.hypot(point.x - current.start.x, point.y - current.start.y) >= DRAG_THRESHOLD
      const additive = current.additive
      cancel()
      if (!moved) return true
      consumedClick.current = true
      const viewportBox = normalizeBox(current.start, point)
      const matched = boardsIntersectingRect(boards, bounds, toCanvasRect(viewportBox))
      onCommit(matched, additive)
      return true
    },
  }
}
