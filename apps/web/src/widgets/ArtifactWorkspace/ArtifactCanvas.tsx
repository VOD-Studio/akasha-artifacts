import { Button } from '@akasha/ui/button'
import { Hand, Maximize, Minus, Plus } from 'lucide-react'
import { type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { ElementPickerButton } from '../../features/element-picker/ElementPickerButton'

const BOARD_WIDTH = 1280
const BOARD_HEIGHT = 800
const GUTTER = 24
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2] as const

interface CanvasDrag {
  pointerId: number
  x: number
  y: number
  left: number
  top: number
}

export function ArtifactCanvas({ children, visible }: { children: ReactNode; visible: boolean }) {
  const viewportRef = useRef<HTMLElement>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<CanvasDrag | null>(null)
  const zoomCenterRef = useRef<{ x: number; y: number } | null>(null)
  const [availableScale, setAvailableScale] = useState(1)
  const [zoom, setZoom] = useState<number | null>(null)
  const [hand, setHand] = useState(false)
  const setPickerActive = useSelectionStore((s) => s.setPickerActive)

  const fit = Math.min(1, availableScale)
  const scale = zoom ?? fit
  const smaller = ZOOM_LEVELS.findLast((level) => level < scale) ?? fit
  const larger = ZOOM_LEVELS.find((level) => level > scale)
  const canPan = scale > availableScale
  const handActive = hand && canPan

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      // 测量滚动条之外的视口，避免放大后显示滚动条使「适应画布」的比例来回变化。
      const { offsetWidth, offsetHeight } = viewport
      if (!offsetWidth || !offsetHeight) return
      const widthScale = (offsetWidth - 2 * GUTTER) / BOARD_WIDTH
      const heightScale = (offsetHeight - 2 * GUTTER) / BOARD_HEIGHT
      setAvailableScale(Math.max(0.05, Math.min(widthScale, heightScale)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport, { box: 'border-box' })
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const board = boardRef.current
    const center = zoomCenterRef.current
    if (!viewport || !board || !center) return
    zoomCenterRef.current = null
    viewport.scrollLeft = board.offsetLeft + center.x * scale - viewport.clientWidth / 2
    viewport.scrollTop = board.offsetTop + center.y * scale - viewport.clientHeight / 2
  }, [scale])

  const changeZoom = (next: number | null) => {
    if (zoom === next) return
    const viewport = viewportRef.current
    const board = boardRef.current
    if ((next ?? fit) !== scale && viewport && board) {
      zoomCenterRef.current = {
        x: (viewport.scrollLeft + viewport.clientWidth / 2 - board.offsetLeft) / scale,
        y: (viewport.scrollTop + viewport.clientHeight / 2 - board.offsetTop) / scale,
      }
    }
    if ((next ?? fit) <= availableScale) setHand(false)
    setZoom(next)
  }

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (!handActive || event.button !== 0 || dragRef.current) return
    event.preventDefault()
    const viewport = event.currentTarget
    viewport.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }
  }

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (drag?.pointerId !== event.pointerId) return
    event.currentTarget.scrollLeft = drag.left + drag.x - event.clientX
    event.currentTarget.scrollTop = drag.top + drag.y - event.clientY
  }

  return (
    <div hidden={!visible} className={visible ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      <section
        ref={viewportRef}
        aria-label="制品画布"
        className={`artifact-canvas relative min-h-0 flex-1 overflow-auto overscroll-contain ${
          handActive ? 'touch-none cursor-grab select-none active:cursor-grabbing' : ''
        }`}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onLostPointerCapture={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
        }}
      >
        <div
          className="flex min-h-full w-max min-w-full items-center justify-center"
          style={{ padding: GUTTER }}
        >
          <div
            ref={boardRef}
            className="relative shrink-0 overflow-hidden bg-white shadow-sm outline outline-border"
            style={{ width: BOARD_WIDTH * scale, height: BOARD_HEIGHT * scale }}
          >
            {/* 沙盒回传的坐标以未缩放视口为基准，预览与叠层必须一起缩放。 */}
            <div
              inert={handActive}
              className="absolute top-0 left-0 origin-top-left"
              style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${scale})` }}
            >
              {children}
            </div>
          </div>
        </div>
      </section>
      <section
        aria-label="画布工具"
        className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border bg-surface px-2 py-1 sm:px-4"
      >
        <div className="flex items-center gap-1">
          <ElementPickerButton onStart={() => setHand(false)} />
          <span className="ml-2 hidden text-xs text-ink-muted sm:inline">
            {BOARD_WIDTH} × {BOARD_HEIGHT}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant={handActive ? 'secondary' : 'ghost'}
            size="sm"
            iconOnly
            aria-label="抓手平移"
            title={canPan ? '抓手平移' : '放大后可平移画布'}
            disabled={!canPan}
            aria-pressed={handActive}
            onClick={() => {
              setPickerActive(false)
              setHand(!handActive)
            }}
          >
            <Hand size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="缩小画布"
            title="缩小画布"
            disabled={smaller >= scale}
            onClick={() => changeZoom(smaller)}
          >
            <Minus size={15} />
          </Button>
          <output
            aria-label="画布缩放比例"
            className="w-10 text-center text-xs tabular-nums text-ink"
          >
            {Math.round(scale * 100)}%
          </output>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="放大画布"
            title="放大画布"
            disabled={larger === undefined}
            onClick={() => {
              if (larger !== undefined) changeZoom(larger)
            }}
          >
            <Plus size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label="适应画布"
            title="适应画布"
            aria-pressed={zoom === null}
            onClick={() => changeZoom(null)}
          >
            <Maximize size={15} />
          </Button>
        </div>
      </section>
    </div>
  )
}
