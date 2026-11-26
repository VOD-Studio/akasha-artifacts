import { ARTBOARD_GEOMETRY_LIMITS, type DesignLayer, type VersionSummary } from '@akasha/protocol'
import { Circle, Pencil, PenTool, Square, StickyNote, Type } from 'lucide-react'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { Point } from '../lib/canvas-camera'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

/** 每种绘制工具决定预览形状与写入版本的原生图层类型。 */
export const DRAWING_TOOLS = {
  text: { kind: 'text', label: '添加文本', shortcut: 'T', icon: Type },
  note: { kind: 'note', label: '添加便签', shortcut: 'N', icon: StickyNote },
  rectangle: { kind: 'rectangle', label: '绘制矩形', shortcut: 'R', icon: Square },
  ellipse: { kind: 'ellipse', label: '绘制椭圆', shortcut: 'O', icon: Circle },
  stroke: { kind: 'stroke', label: '画笔', shortcut: 'B', icon: Pencil },
  pen: { kind: 'pen', label: '钢笔', shortcut: 'P', icon: PenTool },
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

function clampCoord(value: number) {
  const limit = ARTBOARD_GEOMETRY_LIMITS.coordinate
  return Math.min(limit, Math.max(-limit, value))
}

function boundsOf(start: Point, end: Point): CanvasBounds {
  const x = clampCoord(Math.floor(Math.min(start.x, end.x)))
  const y = clampCoord(Math.floor(Math.min(start.y, end.y)))
  const maxWidth = ARTBOARD_GEOMETRY_LIMITS.viewport
  return {
    x,
    y,
    width: Math.min(maxWidth, Math.max(1, Math.ceil(Math.max(start.x, end.x)) - x)),
    height: Math.min(maxWidth, Math.max(1, Math.ceil(Math.max(start.y, end.y)) - y)),
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
  /** 仅在指针拖拽过程中锁定滚轮，静止选工具时仍可自由缩放。 */
  onDraggingChange?: (dragging: boolean) => void
}

/** 铅笔在松开指针后提交；钢笔按节点构路，支持跨出画板边界并在显式完成时提交。 */
export function BoardDrawingSurface({
  board,
  tool,
  version,
  onCreate,
  onDraggingChange,
}: SurfaceProps) {
  const { t } = useMessages(canvasToolsMessages)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const path = useRef<{ points: Point[]; base: VersionSummary; anchor: Point } | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<CanvasBounds | Point[] | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const { width, height } = board

  const toUnclampedBoardPoint = (
    frame: DOMRect,
    { clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>,
  ): Point => ({
    x: clampCoord(((clientX - frame.left) * width) / frame.width),
    y: clampCoord(((clientY - frame.top) * height) / frame.height),
  })

  const commitShape = (start: Point, end: Point, base: VersionSummary, anchor: Point) => {
    if (tool.kind === 'stroke' || tool.kind === 'pen') return
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

  const commitStroke = (points: Point[], base: VersionSummary, anchor: Point) => {
    if (points.length < 2) return
    const low = { ...points[0] }
    const high = { ...points[0] }
    for (const { x, y } of points) {
      low.x = Math.min(low.x, x)
      low.y = Math.min(low.y, y)
      high.x = Math.max(high.x, x)
      high.y = Math.max(high.y, y)
    }
    // 留出笔尖宽度且不强行裁在板边内，允许跨画板边界的路径保留真实几何。
    const bounds = boundsOf({ x: low.x - 2, y: low.y - 2 }, { x: high.x + 2, y: high.y + 2 })
    onCreate(
      {
        id: crypto.randomUUID(),
        kind: 'stroke',
        ...bounds,
        points: points.map(({ x, y }) => [
          Math.min(1, Math.max(0, (x - bounds.x) / bounds.width)),
          Math.min(1, Math.max(0, (y - bounds.y) / bounds.height)),
        ]),
      },
      base,
      anchor,
    )
  }

  const finishPath = () => {
    const line = path.current
    if (!line || line.points.length < 2) return
    path.current = null
    setPreview(null)
    setCursor(null)
    commitStroke(line.points, line.base, line.anchor)
  }

  const addNode = (point: Point, anchor: Point) => {
    const line = path.current ?? { points: [], base: version, anchor }
    if (!line.points.length) line.points.push(point)
    else if (line.points.length < INK_LIMIT) sample(line.points, point, true)
    line.anchor = anchor
    path.current = line
    setPreview([...line.points])
    setCursor(point)
  }

  // 钢笔起笔在当前画板后，允许在画布空白或邻板继续落点并跨板边界成路。
  useEffect(() => {
    if (tool.kind !== 'pen' || !Array.isArray(preview)) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || !path.current || !buttonRef.current)
        return
      const target = event.target instanceof Element ? event.target : null
      if (!target || buttonRef.current.contains(target)) return
      if (!target.closest('.artifact-canvas')) return
      const frame = buttonRef.current.getBoundingClientRect()
      if (!frame.width || !frame.height) return
      event.stopPropagation()
      event.preventDefault()
      addNode(toUnclampedBoardPoint(frame, event), { x: event.clientX, y: event.clientY })
      buttonRef.current.focus({ preventScroll: true })
    }
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (!path.current || !buttonRef.current) return
      const frame = buttonRef.current.getBoundingClientRect()
      if (!frame.width || !frame.height) return
      setCursor(toUnclampedBoardPoint(frame, event))
    }
    const onDoubleClick = (event: globalThis.MouseEvent) => {
      if (!path.current || !buttonRef.current) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || buttonRef.current.contains(target) || !target.closest('.artifact-canvas'))
        return
      event.stopPropagation()
      finishPath()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('dblclick', onDoubleClick, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('dblclick', onDoubleClick, true)
    }
  })

  let action = t(tool.label)
  if (tool.kind === 'stroke') action = t('绘制笔迹')
  if (tool.kind === 'pen') action = t('绘制折线')

  const cancel = () => {
    gesture.current = null
    path.current = null
    setPreview(null)
    setCursor(null)
    onDraggingChange?.(false)
  }

  const pointPreview = Array.isArray(preview) ? preview : null
  const strokePointsAttr = pointPreview?.map(({ x, y }) => `${x},${y}`).join(' ') ?? null
  const shapePreview = preview && !Array.isArray(preview) ? preview : null

  // 命中区与画板同尺寸，保留原生按钮的键盘点击，不套用通用按钮的尺寸。
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={t('在{title}{action}', { title: board.title, action })}
      title={tool.kind === 'pen' ? t('点击添加节点；双击或按 Enter 完成，Esc 取消') : undefined}
      className="artifact-canvas-board-hit z-2 touch-none overflow-visible focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || gesture.current) return
        const frame = event.currentTarget.getBoundingClientRect()
        if (!frame.width || !frame.height) return
        const toBoardPoint = (point: Pick<PointerEvent, 'clientX' | 'clientY'>): Point =>
          toUnclampedBoardPoint(frame, point)
        const start = toBoardPoint(event)
        event.stopPropagation()
        if (tool.kind === 'pen') {
          event.currentTarget.focus({ preventScroll: true })
          addNode(start, { x: event.clientX, y: event.clientY })
          return
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        gesture.current = {
          pointer: event.pointerId,
          base: version,
          start,
          toBoardPoint,
          points: [start],
        }
        onDraggingChange?.(true)
      }}
      onPointerMove={(event) => {
        if (tool.kind === 'pen' && path.current) {
          const frame = event.currentTarget.getBoundingClientRect()
          if (frame.width && frame.height) setCursor(toUnclampedBoardPoint(frame, event))
          return
        }
        const drawing = gesture.current
        if (!drawing || event.pointerId !== drawing.pointer) return
        event.stopPropagation()
        const point = drawing.toBoardPoint(event)
        if (tool.kind === 'stroke') {
          sample(drawing.points, point)
          setPreview([...drawing.points])
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
        commitStroke(drawing.points, drawing.base, anchor)
      }}
      onPointerCancel={(event) => {
        if (
          event.isPrimary !== false &&
          (!gesture.current || gesture.current.pointer === event.pointerId)
        )
          cancel()
      }}
      onLostPointerCapture={(event) => {
        if (gesture.current && gesture.current.pointer === event.pointerId) cancel()
      }}
      onKeyDown={(event) => {
        if (tool.kind === 'pen' && event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          finishPath()
        }
      }}
      onDoubleClick={tool.kind === 'pen' ? finishPath : undefined}
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
          className="pointer-events-none block size-full overflow-visible text-primary"
        >
          {strokePointsAttr && (
            <polyline
              points={strokePointsAttr}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {tool.kind === 'pen' && pointPreview && cursor && pointPreview.length >= 1 && (
            <line
              x1={pointPreview[pointPreview.length - 1].x}
              y1={pointPreview[pointPreview.length - 1].y}
              x2={cursor.x}
              y2={cursor.y}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {tool.kind === 'pen' &&
            pointPreview?.map((node, index) => (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: 节点预览按顺序添加。
                key={index}
                cx={node.x}
                cy={node.y}
                r={3}
                fill="var(--card)"
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
            ))}
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
