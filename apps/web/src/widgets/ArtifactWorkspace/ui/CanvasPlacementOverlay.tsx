import {
  ARTBOARD_GEOMETRY_LIMITS,
  ARTIFACT_DEFAULT_VIEWPORT,
  type DesignLayer,
  type VersionSummary,
} from '@akasha/protocol'
import { type PointerEvent, useEffect, useRef, useState } from 'react'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import type { Camera, Point } from '../lib/canvas-camera'
import { resolveLayerOwnerBoard } from '../lib/canvas-layer-navigation'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'
import type { DrawingTool } from './BoardDrawingSurface'

const MIN_ARTBOARD_EDGE = 32
const INK_LIMIT = 2048
const PRESET_LAYER_SIZE = {
  text: [160, 28],
  note: [220, 112],
  rectangle: [120, 80],
  ellipse: [120, 80],
} as const

interface ArtboardPlacerProps {
  camera: Camera
  version: VersionSummary
  size: { width: number; height: number }
  onPlace: (bounds: CanvasBounds, base: VersionSummary) => void
  onCancel: () => void
  onDraggingChange?: (dragging: boolean) => void
}

function clampCoord(value: number) {
  const limit = ARTBOARD_GEOMETRY_LIMITS.coordinate
  return Math.min(limit, Math.max(-limit, Math.round(value)))
}

function clampViewport(value: number) {
  return Math.min(ARTBOARD_GEOMETRY_LIMITS.viewport, Math.max(1, Math.round(value)))
}

function boundsFromPoints(start: Point, end: Point): CanvasBounds {
  const x = clampCoord(Math.min(start.x, end.x))
  const y = clampCoord(Math.min(start.y, end.y))
  return {
    x,
    y,
    width: clampViewport(Math.ceil(Math.max(start.x, end.x)) - x),
    height: clampViewport(Math.ceil(Math.max(start.y, end.y)) - y),
  }
}

/** 画板工具激活时覆盖画布，按指针落点或拖出范围创建画板。 */
export function CanvasArtboardPlacer({
  camera,
  version,
  size,
  onPlace,
  onCancel,
  onDraggingChange,
}: ArtboardPlacerProps) {
  const { t } = useMessages(canvasToolsMessages)
  const drag = useRef<{
    pointerId: number
    start: Point
    rect: DOMRect
    base: VersionSummary
  } | null>(null)
  const [preview, setPreview] = useState<CanvasBounds | null>(null)

  const toCanvasPoint = (rect: DOMRect, clientX: number, clientY: number): Point => ({
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
  })

  const clear = () => {
    drag.current = null
    setPreview(null)
    onDraggingChange?.(false)
  }

  return (
    <button
      type="button"
      data-testid="canvas-artboard-placer"
      aria-label={t('在画布上放置画板')}
      title={t('点击或拖动以放置新画板，Esc 取消')}
      className="artifact-canvas-placement"
      onPointerDown={(event) => {
        if (event.button !== 0 || event.isPrimary === false || drag.current) return
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const start = toCanvasPoint(rect, event.clientX, event.clientY)
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = { pointerId: event.pointerId, start, rect, base: version }
        onDraggingChange?.(true)
      }}
      onPointerMove={(event) => {
        const active = drag.current
        if (!active || event.pointerId !== active.pointerId) return
        event.stopPropagation()
        const point = toCanvasPoint(active.rect, event.clientX, event.clientY)
        if (Math.hypot(point.x - active.start.x, point.y - active.start.y) * camera.scale < 4)
          return
        setPreview(boundsFromPoints(active.start, point))
      }}
      onPointerUp={(event) => {
        const active = drag.current
        if (!active || event.pointerId !== active.pointerId) return
        event.stopPropagation()
        const end = toCanvasPoint(active.rect, event.clientX, event.clientY)
        const base = active.base
        const dragged =
          Math.hypot(end.x - active.start.x, end.y - active.start.y) * camera.scale >= 4
        clear()
        if (dragged) {
          const box = boundsFromPoints(active.start, end)
          onPlace(
            {
              x: box.x,
              y: box.y,
              width: Math.max(MIN_ARTBOARD_EDGE, box.width),
              height: Math.max(MIN_ARTBOARD_EDGE, box.height),
            },
            base,
          )
          return
        }
        onPlace(
          {
            x: clampCoord(active.start.x),
            y: clampCoord(active.start.y),
            width: ARTIFACT_DEFAULT_VIEWPORT.width,
            height: ARTIFACT_DEFAULT_VIEWPORT.height,
          },
          base,
        )
      }}
      onPointerCancel={(event) => {
        if (drag.current && drag.current.pointerId === event.pointerId) clear()
      }}
      onLostPointerCapture={(event) => {
        if (drag.current && drag.current.pointerId === event.pointerId) clear()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          clear()
          onCancel()
        }
      }}
      onClick={(event) => {
        if (event.detail !== 0) return
        // 键盘激活画板工具时落在当前视口中央，而不是无定位追加。
        const centerX = (size.width / 2 - camera.x) / camera.scale
        const centerY = (size.height / 2 - camera.y) / camera.scale
        const width = ARTIFACT_DEFAULT_VIEWPORT.width
        const height = ARTIFACT_DEFAULT_VIEWPORT.height
        onPlace(
          {
            x: clampCoord(centerX - width / 2),
            y: clampCoord(centerY - height / 2),
            width,
            height,
          },
          version,
        )
      }}
    >
      {preview ? (
        <div
          data-testid="canvas-artboard-preview"
          className="pointer-events-none absolute border-2 border-dashed border-(--canvas-selection) bg-(--canvas-selection-tint)"
          style={{
            left: camera.x + preview.x * camera.scale,
            top: camera.y + preview.y * camera.scale,
            width: preview.width * camera.scale,
            height: preview.height * camera.scale,
          }}
        >
          <span
            dir="ltr"
            className="absolute bottom-1 right-1 rounded bg-(--canvas-selection) px-1.5 py-0.5 font-mono text-[10px] text-(--canvas-selection-foreground)"
          >
            {preview.width} × {preview.height}
          </span>
        </div>
      ) : null}
    </button>
  )
}

interface BlankDrawingProps {
  tool: DrawingTool
  camera: Camera
  boards: readonly CanvasBoard[]
  bounds: ReadonlyMap<string, CanvasBounds>
  version: VersionSummary
  onCreate: (board: CanvasBoard, layer: DesignLayer, base: VersionSummary, anchor: Point) => void
  onUnowned: () => void
  onDraggingChange?: (dragging: boolean) => void
}

function samplePath(points: Point[], point: Point, final = false) {
  const last = points[points.length - 1]
  if (Math.hypot(last.x - point.x, last.y - point.y) < (final ? Number.EPSILON : 0.75)) return
  if (points.length === INK_LIMIT) {
    let write = 1
    for (let read = 2; read < points.length - 1; read += 2) points[write++] = points[read]
    points[write++] = last
    points.length = write
  }
  points.push(point)
}

/**
 * 接收空白画布区域起笔的绘图与路径输入；若最终几何跨越到某画板则归属该画板，纯空白则提示不保存。
 */
export function CanvasBlankDrawingOverlay({
  tool,
  camera,
  boards,
  bounds,
  version,
  onCreate,
  onUnowned,
  onDraggingChange,
}: BlankDrawingProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    start: Point
    rect: DOMRect
    base: VersionSummary
    points: Point[]
  } | null>(null)
  const penPath = useRef<{ points: Point[]; base: VersionSummary; anchor: Point } | null>(null)
  const [previewBox, setPreviewBox] = useState<CanvasBounds | null>(null)
  const [previewPoints, setPreviewPoints] = useState<Point[] | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)

  const toCanvasPoint = (rect: DOMRect, clientX: number, clientY: number): Point => ({
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
  })

  const clear = () => {
    drag.current = null
    penPath.current = null
    setPreviewBox(null)
    setPreviewPoints(null)
    setCursor(null)
    onDraggingChange?.(false)
  }

  const commitPoints = (points: Point[], base: VersionSummary, anchor: Point) => {
    if (points.length < 2) return
    let minX = points[0].x
    let minY = points[0].y
    let maxX = points[0].x
    let maxY = points[0].y
    for (const point of points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    const canvasRect = boundsFromPoints({ x: minX - 2, y: minY - 2 }, { x: maxX + 2, y: maxY + 2 })
    const owner = resolveLayerOwnerBoard(boards, bounds, canvasRect)
    if (!owner) {
      onUnowned()
      return
    }
    const boardBounds = bounds.get(owner.board.id)
    if (!boardBounds) {
      onUnowned()
      return
    }
    const localBounds = owner.localBounds
    const normalized: Array<[number, number]> = points.map(({ x, y }) => [
      Math.min(1, Math.max(0, (x - boardBounds.x - localBounds.x) / localBounds.width)),
      Math.min(1, Math.max(0, (y - boardBounds.y - localBounds.y) / localBounds.height)),
    ])
    onCreate(
      owner.board,
      { id: crypto.randomUUID(), kind: 'stroke', ...localBounds, points: normalized },
      base,
      anchor,
    )
  }

  const addPenNode = (start: Point, anchor: Point) => {
    const current = penPath.current ?? { points: [], base: version, anchor }
    if (!current.points.length) current.points.push(start)
    else if (current.points.length < INK_LIMIT) samplePath(current.points, start, true)
    current.anchor = anchor
    penPath.current = current
    setPreviewPoints([...current.points])
    setCursor(start)
  }

  const finishPen = () => {
    const active = penPath.current
    if (!active || active.points.length < 2) return
    clear()
    commitPoints(active.points, active.base, active.anchor)
  }

  // 钢笔从空白画布起笔后，捕获后续跨入任意画板的点击、双击和 Enter，避免被画板绘制层拆断路径。
  useEffect(() => {
    if (tool.kind !== 'pen' || !Array.isArray(previewPoints)) return
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (
        event.button !== 0 ||
        event.isPrimary === false ||
        !penPath.current ||
        !overlayRef.current
      )
        return
      const target = event.target instanceof Element ? event.target : null
      if (!target || overlayRef.current.contains(target) || !target.closest('.artifact-canvas'))
        return
      const rect = overlayRef.current.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      event.stopPropagation()
      event.preventDefault()
      addPenNode(toCanvasPoint(rect, event.clientX, event.clientY), {
        x: event.clientX,
        y: event.clientY,
      })
    }
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (!penPath.current || !overlayRef.current) return
      const rect = overlayRef.current.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      setCursor(toCanvasPoint(rect, event.clientX, event.clientY))
    }
    const onDoubleClick = (event: globalThis.MouseEvent) => {
      if (!penPath.current || !overlayRef.current) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || overlayRef.current.contains(target) || !target.closest('.artifact-canvas'))
        return
      event.stopPropagation()
      finishPen()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!penPath.current || event.isComposing) return
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        finishPen()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        clear()
      }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('dblclick', onDoubleClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('dblclick', onDoubleClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 空白画布的指针起笔表面，键盘绘制仍通过画板按钮触发。
    <div
      ref={overlayRef}
      data-testid="canvas-blank-drawing"
      className="artifact-canvas-blank-drawing pointer-events-auto absolute inset-0 z-0 touch-none"
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || event.isPrimary === false || drag.current) return
        const rect = event.currentTarget.getBoundingClientRect()
        const start = toCanvasPoint(rect, event.clientX, event.clientY)
        event.stopPropagation()
        if (tool.kind === 'pen') {
          addPenNode(start, { x: event.clientX, y: event.clientY })
          return
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
        drag.current = {
          pointerId: event.pointerId,
          start,
          rect,
          base: version,
          points: [start],
        }
        onDraggingChange?.(true)
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (tool.kind === 'pen' && penPath.current) {
          const rect = event.currentTarget.getBoundingClientRect()
          setCursor(toCanvasPoint(rect, event.clientX, event.clientY))
          return
        }
        const active = drag.current
        if (!active || event.pointerId !== active.pointerId) return
        event.stopPropagation()
        const point = toCanvasPoint(active.rect, event.clientX, event.clientY)
        if (tool.kind === 'stroke') {
          samplePath(active.points, point)
          setPreviewPoints([...active.points])
        } else {
          setPreviewBox(boundsFromPoints(active.start, point))
        }
      }}
      onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
        const active = drag.current
        if (!active || event.pointerId !== active.pointerId) return
        event.stopPropagation()
        const end = toCanvasPoint(active.rect, event.clientX, event.clientY)
        const anchor = { x: event.clientX, y: event.clientY }
        const base = active.base
        const points = [...active.points]
        clear()
        if (tool.kind === 'stroke') {
          samplePath(points, end, true)
          commitPoints(points, base, anchor)
          return
        }
        if (tool.kind === 'pen') return
        const moved = Math.hypot(end.x - active.start.x, end.y - active.start.y) >= 3
        const [presetWidth, presetHeight] = PRESET_LAYER_SIZE[tool.kind]
        const hitRect = moved
          ? boundsFromPoints(active.start, end)
          : {
              x: clampCoord(active.start.x),
              y: clampCoord(active.start.y),
              width: 1,
              height: 1,
            }
        const owner = resolveLayerOwnerBoard(boards, bounds, hitRect)
        if (!owner) {
          onUnowned()
          return
        }
        const localBounds = moved
          ? owner.localBounds
          : {
              ...owner.localBounds,
              width: Math.min(presetWidth, owner.board.width),
              height: Math.min(presetHeight, owner.board.height),
            }
        const id = crypto.randomUUID()
        if (tool.kind === 'text' || tool.kind === 'note') {
          onCreate(owner.board, { id, kind: tool.kind, ...localBounds, text: '' }, base, anchor)
        } else {
          onCreate(
            owner.board,
            { id, kind: tool.kind, ...localBounds, color: 'blue' },
            base,
            anchor,
          )
        }
      }}
      onPointerCancel={(event) => {
        if (
          event.isPrimary !== false &&
          (!drag.current || drag.current.pointerId === event.pointerId)
        )
          clear()
      }}
      onLostPointerCapture={(event) => {
        if (drag.current && drag.current.pointerId === event.pointerId) clear()
      }}
      onDoubleClick={tool.kind === 'pen' ? finishPen : undefined}
    >
      {previewBox || previewPoints ? (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full overflow-visible text-(--canvas-selection)"
        >
          {previewBox && tool.kind === 'ellipse' ? (
            <ellipse
              cx={camera.x + (previewBox.x + previewBox.width / 2) * camera.scale}
              cy={camera.y + (previewBox.y + previewBox.height / 2) * camera.scale}
              rx={(previewBox.width * camera.scale) / 2}
              ry={(previewBox.height * camera.scale) / 2}
              fill="#dbeafe"
              fillOpacity={0.55}
              stroke="#1d4ed8"
              strokeWidth={1.5}
            />
          ) : null}
          {previewBox && tool.kind === 'rectangle' ? (
            <rect
              x={camera.x + previewBox.x * camera.scale}
              y={camera.y + previewBox.y * camera.scale}
              width={previewBox.width * camera.scale}
              height={previewBox.height * camera.scale}
              fill="#dbeafe"
              fillOpacity={0.55}
              stroke="#1d4ed8"
              strokeWidth={1.5}
            />
          ) : null}
          {previewBox && tool.kind === 'note' ? (
            <rect
              x={camera.x + previewBox.x * camera.scale}
              y={camera.y + previewBox.y * camera.scale}
              width={previewBox.width * camera.scale}
              height={previewBox.height * camera.scale}
              rx={4}
              fill="#fef3c7"
              fillOpacity={0.78}
              stroke="#d97706"
              strokeWidth={1.5}
            />
          ) : null}
          {previewBox && tool.kind === 'text' ? (
            <rect
              x={camera.x + previewBox.x * camera.scale}
              y={camera.y + previewBox.y * camera.scale}
              width={previewBox.width * camera.scale}
              height={previewBox.height * camera.scale}
              fill="currentColor"
              fillOpacity={0.04}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          ) : null}
          {previewPoints ? (
            <>
              <polyline
                points={previewPoints
                  .map(
                    ({ x, y }) => `${camera.x + x * camera.scale},${camera.y + y * camera.scale}`,
                  )
                  .join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {tool.kind === 'pen' && cursor && previewPoints.length >= 1 ? (
                <line
                  x1={camera.x + previewPoints[previewPoints.length - 1].x * camera.scale}
                  y1={camera.y + previewPoints[previewPoints.length - 1].y * camera.scale}
                  x2={camera.x + cursor.x * camera.scale}
                  y2={camera.y + cursor.y * camera.scale}
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              ) : null}
              {tool.kind === 'pen'
                ? previewPoints.map((pt, index) => (
                    <circle
                      // biome-ignore lint/suspicious/noArrayIndexKey: 临时节点预览按点击顺序渲染。
                      key={index}
                      cx={camera.x + pt.x * camera.scale}
                      cy={camera.y + pt.y * camera.scale}
                      r={3.5}
                      fill="var(--card)"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    />
                  ))
                : null}
            </>
          ) : null}
        </svg>
      ) : null}
    </div>
  )
}
