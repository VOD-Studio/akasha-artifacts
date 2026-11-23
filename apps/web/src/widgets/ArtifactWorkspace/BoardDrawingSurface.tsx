import type { DesignLayer, Version } from '@akasha/protocol'
import { Circle, PenLine, Square } from 'lucide-react'
import { type PointerEvent, useRef, useState } from 'react'
import type { CanvasBounds, Point } from './canvas-camera'
import type { CanvasBoard } from './canvas-model'

/** 原生图层工具按声明顺序出现在画布工具条。 */
export const DRAWING_TOOLS = [
  { kind: 'rectangle', label: '绘制矩形', icon: Square },
  { kind: 'ellipse', label: '绘制椭圆', icon: Circle },
  { kind: 'stroke', label: '画笔', icon: PenLine },
] as const

/** 当前工具决定预览形状与写入版本的原生图层类型。 */
export type DrawingTool = (typeof DRAWING_TOOLS)[number]

interface Gesture {
  pointer: number
  base: Version
  start: Point
  toBoardPoint: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => Point
  points: Point[]
}

const INK_LIMIT = 2048
function boundsOf(start: Point, end: Point): CanvasBounds {
  const x = Math.floor(Math.min(start.x, end.x))
  const y = Math.floor(Math.min(start.y, end.y))
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(Math.max(start.x, end.x)) - x),
    height: Math.max(1, Math.ceil(Math.max(start.y, end.y)) - y),
  }
}

interface SurfaceProps {
  board: CanvasBoard
  tool: DrawingTool
  /** 画笔或拖拽只以按下时的版本为基准。 */
  version: Version
  onCreate(layer: DesignLayer, base: Version): void
}

/** 只在松开指针后发布；绘制预览和相机都不进入源码。 */
export function BoardDrawingSurface({ board, tool, version, onCreate }: SurfaceProps) {
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<CanvasBounds | string | null>(null)
  const { width, height } = board

  function boardCoordinates(rect: DOMRect) {
    return ({ clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>): Point => ({
      x: Math.min(width, Math.max(0, ((clientX - rect.left) * width) / rect.width)),
      y: Math.min(height, Math.max(0, ((clientY - rect.top) * height) / rect.height)),
    })
  }

  function commitShape(start: Point, end: Point, base: Version) {
    if (tool.kind === 'stroke') return
    const moved = Math.hypot(end.x - start.x, end.y - start.y) >= 3
    const bounds = moved
      ? boundsOf(start, end)
      : {
          x: Math.min(Math.round(start.x), Math.max(0, width - 120)),
          y: Math.min(Math.round(start.y), Math.max(0, height - 80)),
          width: Math.min(120, width),
          height: Math.min(80, height),
        }
    onCreate({ id: crypto.randomUUID(), kind: tool.kind, ...bounds, color: 'blue' }, base)
  }

  function sample(points: Point[], point: Point, final = false) {
    const last = points[points.length - 1]
    if (Math.hypot(last.x - point.x, last.y - point.y) < (final ? Number.EPSILON : 0.75)) return
    if (points.length < INK_LIMIT) points.push(point)
    else points[INK_LIMIT - 1] = point
  }

  function cancel() {
    gesture.current = null
    setPreview(null)
  }

  return (
    <button
      type="button"
      aria-label={`在${board.title}${tool.kind === 'stroke' ? '画笔标记' : tool.label}`}
      className="artifact-canvas-board-hit z-2 cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onPointerDown={(event) => {
        if (event.button !== 0 || gesture.current) return
        const frame = event.currentTarget.getBoundingClientRect()
        if (!frame.width || !frame.height) return
        const toBoardPoint = boardCoordinates(frame)
        const start = toBoardPoint(event)
        event.stopPropagation()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        gesture.current = {
          pointer: event.pointerId,
          base: version,
          start,
          toBoardPoint,
          points: [start],
        }
      }}
      onPointerMove={(event) => {
        const drawing = gesture.current
        if (!drawing || event.pointerId !== drawing.pointer) return
        event.stopPropagation()
        const point = drawing.toBoardPoint(event)
        if (tool.kind === 'stroke') {
          sample(drawing.points, point)
          setPreview(drawing.points.map(({ x, y }) => `${x},${y}`).join(' '))
        } else setPreview(boundsOf(drawing.start, point))
      }}
      onPointerUp={(event) => {
        const drawing = gesture.current
        if (!drawing || event.pointerId !== drawing.pointer) return
        event.stopPropagation()
        const end = drawing.toBoardPoint(event)
        cancel()
        if (tool.kind !== 'stroke') {
          commitShape(drawing.start, end, drawing.base)
          return
        }
        sample(drawing.points, end, true)
        if (drawing.points.length < 2) return
        const low = { ...drawing.start }
        const high = { ...drawing.start }
        for (const { x, y } of drawing.points) {
          low.x = Math.min(low.x, x)
          low.y = Math.min(low.y, y)
          high.x = Math.max(high.x, x)
          high.y = Math.max(high.y, y)
        }
        // 留出笔尖宽度，避免垂直或水平的线被自己的边界裁掉。
        const bounds = boundsOf(
          { x: Math.max(0, low.x - 2), y: Math.max(0, low.y - 2) },
          { x: Math.min(width, high.x + 2), y: Math.min(height, high.y + 2) },
        )
        onCreate(
          {
            id: crypto.randomUUID(),
            kind: 'stroke',
            ...bounds,
            points: drawing.points.map(({ x, y }) => [
              (x - bounds.x) / bounds.width,
              (y - bounds.y) / bounds.height,
            ]),
          },
          drawing.base,
        )
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onClick={(event) => {
        if (event.detail !== 0) return
        const start = { x: width / 2, y: height / 2 }
        commitShape(start, start, version)
      }}
    >
      {preview ? (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="pointer-events-none block size-full text-primary"
        >
          {typeof preview === 'string' ? (
            <polyline
              points={preview}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : tool.kind === 'ellipse' ? (
            <ellipse
              cx={preview.x + preview.width / 2}
              cy={preview.y + preview.height / 2}
              rx={preview.width / 2}
              ry={preview.height / 2}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <rect
              {...preview}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      ) : null}
    </button>
  )
}
