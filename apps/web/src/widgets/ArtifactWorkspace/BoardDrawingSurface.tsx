import type { DesignLayer, VersionSummary } from '@akasha/protocol'
import { Circle, PenLine, Square, StickyNote, Type } from 'lucide-react'
import { type PointerEvent, useRef, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import type { CanvasBounds, Point } from './canvas-camera'

/** 每种绘制工具决定预览形状与写入版本的原生图层类型。 */
export const DRAWING_TOOLS = {
  text: { kind: 'text', label: '添加文本', icon: Type },
  note: { kind: 'note', label: '添加便签', icon: StickyNote },
  rectangle: { kind: 'rectangle', label: '绘制矩形', icon: Square },
  ellipse: { kind: 'ellipse', label: '绘制椭圆', icon: Circle },
  stroke: { kind: 'stroke', label: '画笔', icon: PenLine },
} as const

export type DrawingTool = (typeof DRAWING_TOOLS)[keyof typeof DRAWING_TOOLS]

interface Gesture {
  pointer: number
  base: VersionSummary
  start: Point
  toBoardPoint: (event: Pick<PointerEvent, 'clientX' | 'clientY'>) => Point
  points: Point[]
}

const INK_LIMIT = 2048
const PRESET_SIZE = {
  text: [220, 56],
  note: [220, 112],
  rectangle: [120, 80],
  ellipse: [120, 80],
} as const

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

function sample(points: Point[], point: Point, final = false) {
  const last = points[points.length - 1]
  if (Math.hypot(last.x - point.x, last.y - point.y) < (final ? Number.EPSILON : 0.75)) return
  if (points.length === INK_LIMIT) {
    // 压缩已经走过的路径，保留两端，给后续转折留出采样空间。
    let write = 1
    for (let read = 2; read < points.length - 1; read += 2) points[write++] = points[read]
    points[write++] = last
    points.length = write
  }
  points.push(point)
}

interface SurfaceProps {
  /** 固有宽高用于把外壳的缩放视口映射到版内坐标。 */
  board: CanvasBoard
  /** 切换工具时调用方重建命中层，取消未完成的手势。 */
  tool: DrawingTool
  /** 画笔或拖拽只以按下时的版本为基准。 */
  version: VersionSummary
  /** 每个完成的几何只回报一次；文字继续在锚点编辑后才发布。 */
  onCreate(layer: DesignLayer, base: VersionSummary, anchor: Point): void
}

/** 只在松开指针后发布；绘制预览和相机都不进入源码。 */
export function BoardDrawingSurface({ board, tool, version, onCreate }: SurfaceProps) {
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<CanvasBounds | string | null>(null)
  const { width, height } = board

  const commitShape = (start: Point, end: Point, base: VersionSummary, anchor: Point) => {
    if (tool.kind === 'stroke') return
    const [presetWidth, presetHeight] = PRESET_SIZE[tool.kind]
    const moved = Math.hypot(end.x - start.x, end.y - start.y) >= 3
    const bounds = moved
      ? boundsOf(start, end)
      : {
          x: Math.min(Math.round(start.x), Math.max(0, width - presetWidth)),
          y: Math.min(Math.round(start.y), Math.max(0, height - presetHeight)),
          width: Math.min(presetWidth, width),
          height: Math.min(presetHeight, height),
        }
    const id = crypto.randomUUID()
    if (tool.kind === 'text' || tool.kind === 'note') {
      onCreate({ id, kind: tool.kind, ...bounds, text: '' }, base, anchor)
    } else {
      onCreate({ id, kind: tool.kind, ...bounds, color: 'blue' }, base, anchor)
    }
  }

  const cancel = () => {
    gesture.current = null
    setPreview(null)
  }

  const strokePreview = typeof preview === 'string' ? preview : null
  const shapePreview = typeof preview === 'string' ? null : preview

  // 命中区与画板同尺寸，保留原生按钮的键盘点击，不套用通用按钮的尺寸。
  return (
    <button
      type="button"
      aria-label={`在${board.title}${tool.kind === 'stroke' ? '绘制笔迹' : tool.label}`}
      className="artifact-canvas-board-hit z-2 cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onPointerDown={(event) => {
        if (event.button !== 0 || gesture.current) return
        const frame = event.currentTarget.getBoundingClientRect()
        if (!frame.width || !frame.height) return
        const toBoardPoint = ({
          clientX,
          clientY,
        }: Pick<PointerEvent, 'clientX' | 'clientY'>): Point => ({
          x: Math.min(width, Math.max(0, ((clientX - frame.left) * width) / frame.width)),
          y: Math.min(height, Math.max(0, ((clientY - frame.top) * height) / frame.height)),
        })
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
        const anchor = { x: event.clientX, y: event.clientY }
        const end = drawing.toBoardPoint(event)
        cancel()
        if (tool.kind !== 'stroke') {
          commitShape(drawing.start, end, drawing.base, anchor)
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
          anchor,
        )
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onClick={(event) => {
        if (event.detail !== 0) return
        const start = { x: width / 2, y: height / 2 }
        const rect = event.currentTarget.getBoundingClientRect()
        commitShape(start, start, version, {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        })
      }}
    >
      {preview ? (
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="pointer-events-none block size-full text-primary"
        >
          {strokePreview && (
            <polyline
              points={strokePreview}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {shapePreview && tool.kind === 'ellipse' && (
            <ellipse
              cx={shapePreview.x + shapePreview.width / 2}
              cy={shapePreview.y + shapePreview.height / 2}
              rx={shapePreview.width / 2}
              ry={shapePreview.height / 2}
              fill="currentColor"
              fillOpacity={0.15}
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {shapePreview && tool.kind !== 'ellipse' && (
            <rect
              {...shapePreview}
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
