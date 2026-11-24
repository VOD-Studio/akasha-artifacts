import { Button } from '@akasha/ui/button'
import { ArrowLeft, Minus, Play, Plus } from 'lucide-react'
import { type MouseEventHandler, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasBoard } from './canvas-model'
import { useViewportSize } from './useViewportSize'

interface BoardPresentationProps {
  board: CanvasBoard
  visible?: boolean
  playback?: boolean
  onPlay?: MouseEventHandler<HTMLButtonElement>
  onClose: () => void
  children: ReactNode
}

const SCALE_STEP = 1.25
const VIEWPORT_PADDING = 24
const clampScale = (value: number) => Math.min(4, Math.max(0.001, value))

function presentationScale(
  zoom: 'fit' | 'fill' | number,
  measured: boolean,
  widthScale: number,
  fitScale: number,
) {
  if (typeof zoom === 'number') return zoom
  if (!measured) return 1
  return clampScale(zoom === 'fill' ? widthScale : fitScale)
}

/** 聚焦和试玩共享固定画板视口；聚焦与总览的倍率互相独立。 */
export function BoardPresentation({
  board,
  visible = true,
  playback = false,
  onPlay,
  onClose,
  children,
}: BoardPresentationProps) {
  const backRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLElement>(null)
  const size = useViewportSize(scrollRef, visible)
  const [zoom, setZoom] = useState<'fit' | 'fill' | number>('fit')
  const widthScale = Math.max(1, size.width - VIEWPORT_PADDING) / board.width
  const heightScale = Math.max(1, size.height - VIEWPORT_PADDING) / board.height
  const fitScale = playback ? Math.min(1, widthScale) : Math.min(1, widthScale, heightScale)
  const scale = presentationScale(zoom, Boolean(size.width && size.height), widthScale, fitScale)

  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      hidden={!visible}
      aria-label={playback ? '交互预览' : '画板查看'}
      className={visible ? 'flex min-h-0 min-w-0 flex-1 flex-col bg-muted' : 'hidden'}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface p-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            ref={backRef}
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft size={15} />}
            onClick={onClose}
          >
            {playback ? '退出预览' : '返回总览'}
          </Button>
          <h2 className="min-w-0 break-words text-sm font-medium">{board.title}</h2>
        </div>
        {!playback && (
          <fieldset className="flex min-w-0 flex-wrap items-center gap-1">
            <legend className="sr-only">画板缩放</legend>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              适应窗口
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={zoom === 'fill'}
              onClick={() => setZoom('fill')}
            >
              填充宽度
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="缩小"
              disabled={scale <= 0.001}
              onClick={() => setZoom(clampScale(scale / SCALE_STEP))}
            >
              <Minus size={15} />
            </Button>
            <Button variant="ghost" size="sm" aria-label="实际大小" onClick={() => setZoom(1)}>
              <output aria-label="画板缩放比例">{Math.round(scale * 1000) / 10}%</output>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="放大"
              disabled={scale >= 4}
              onClick={() => setZoom(clampScale(scale * SCALE_STEP))}
            >
              <Plus size={15} />
            </Button>
            {onPlay && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play size={15} />}
                aria-label={`播放原型：${board.title}`}
                onClick={onPlay}
              >
                播放原型
              </Button>
            )}
          </fieldset>
        )}
      </header>
      <section
        ref={scrollRef}
        aria-label="画板内容"
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <div className="flex min-h-full min-w-max p-3">
          <div
            className="relative m-auto shrink-0 overflow-hidden bg-surface outline outline-border"
            style={{ width: board.width * scale, height: board.height * scale }}
          >
            <div
              className="absolute top-0 left-0 origin-top-left"
              style={{ width: board.width, height: board.height, transform: `scale(${scale})` }}
            >
              {children}
            </div>
          </div>
        </div>
      </section>
    </section>
  )
}
