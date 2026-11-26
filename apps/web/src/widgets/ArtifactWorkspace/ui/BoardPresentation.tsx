import { Button } from '@akasha/ui/button'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { ArrowLeft, Download, Minus, Play, Plus } from 'lucide-react'
import { type MouseEventHandler, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { useViewportSize } from '../hooks/useViewportSize'
import { type Point, pointInBoard } from '../lib/canvas-camera'
import { navigationMessages } from '../navigation/board-navigation-messages'
import { canvasToolsMessages } from '../toolbar/canvas-tools-messages'

interface BoardPresentationProps {
  board: CanvasBoard
  visible?: boolean
  playback?: boolean
  onPlay?: MouseEventHandler<HTMLButtonElement>
  onExport?: () => void
  onPickText?: (point: Point, anchor: Point) => void
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
  onExport,
  onPickText,
  onClose,
  children,
}: BoardPresentationProps) {
  const { t, number, dir } = useMessages(navigationMessages)
  const { t: toolLabel } = useMessages(canvasToolsMessages)
  const [pickingText, setPickingText] = useState(false)
  const editTrigger = useRef<HTMLButtonElement>(null)
  const pickSurface = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const size = useViewportSize(scrollRef, visible)
  const [zoom, setZoom] = useState<'fit' | 'fill' | number>('fit')
  const widthScale = Math.max(1, size.width - VIEWPORT_PADDING) / board.width
  const heightScale = Math.max(1, size.height - VIEWPORT_PADDING) / board.height
  const fitScale = playback ? Math.min(1, widthScale) : Math.min(1, widthScale, heightScale)
  const scale = presentationScale(zoom, Boolean(size.width && size.height), widthScale, fitScale)

  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => {
    if (pickingText) pickSurface.current?.focus({ preventScroll: true })
  }, [pickingText])

  return (
    <section
      dir={dir}
      hidden={!visible}
      aria-label={t(playback ? '交互预览' : '画板查看')}
      className={
        visible
          ? 'flex min-h-0 min-w-0 flex-1 flex-col bg-canvas max-md:fixed max-md:inset-0 max-md:z-30 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]'
          : 'hidden'
      }
    >
      <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/80 bg-surface/92 px-3 py-1 backdrop-blur-md">
        <div className="flex min-w-0 max-w-full items-center gap-2">
          <Button
            ref={backRef}
            variant="ghost"
            size="sm"
            className="shrink-0"
            leftIcon={<ArrowLeft size={15} className="rtl:rotate-180" />}
            onClick={onClose}
          >
            {t(playback ? '退出预览' : '返回总览')}
          </Button>
          <span aria-hidden="true" className="h-4 w-px bg-border" />
          <h2
            dir="auto"
            title={board.title}
            className="min-w-0 truncate text-sm font-semibold text-ink"
          >
            {board.title}
          </h2>
        </div>
        {!playback && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1 p-1">
            {onPickText && (
              <Button
                ref={editTrigger}
                variant={pickingText ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={pickingText}
                onClick={() => setPickingText(!pickingText)}
              >
                {toolLabel('编辑文字')}
              </Button>
            )}
            {pickingText && onPickText && (
              <span role="status" className="shrink-0 text-xs text-ink-muted">
                {toolLabel('选择要编辑的文字')}
              </span>
            )}
            <fieldset className="flex shrink-0 items-center gap-1">
              <legend className="sr-only">{t('画板缩放')}</legend>
              <Button
                variant={zoom === 'fit' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={zoom === 'fit'}
                onClick={() => setZoom('fit')}
              >
                {t('适应窗口')}
              </Button>
              <Button
                variant={zoom === 'fill' ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={zoom === 'fill'}
                onClick={() => setZoom('fill')}
              >
                {t('填充宽度')}
              </Button>
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={t('缩小')}
                disabled={scale <= 0.001}
                onClick={() => setZoom(clampScale(scale / SCALE_STEP))}
              >
                <Minus size={15} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('实际大小')}
                onClick={() => setZoom(1)}
              >
                <output
                  aria-label={t('画板缩放比例')}
                  className="min-w-10 text-center font-mono text-xs tabular-nums"
                >
                  {number(scale, { style: 'percent', maximumFractionDigits: 1 })}
                </output>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={t('放大')}
                disabled={scale >= 4}
                onClick={() => setZoom(clampScale(scale * SCALE_STEP))}
              >
                <Plus size={15} />
              </Button>
            </fieldset>
            {onExport || onPlay ? (
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
            ) : null}
            {onExport && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Download size={14} />}
                onClick={onExport}
              >
                {t('导出画板')}
              </Button>
            )}
            {onPlay && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play size={14} />}
                aria-label={t('播放原型：{title}', { title: board.title })}
                onClick={onPlay}
              >
                {t('播放原型')}
              </Button>
            )}
          </div>
        )}
      </header>
      <div
        ref={scrollRef}
        dir="ltr"
        className="artifact-canvas-surface min-h-0 flex-1 overflow-hidden"
      >
        <ScrollArea
          orientation="both"
          aria-label={t('画板内容')}
          tabIndex={-1}
          className="h-full w-full overscroll-contain [--v-scroll-area-padding:0px]"
        >
          <div className="flex min-h-full min-w-max p-3">
            <div
              className="relative m-auto shrink-0 overflow-hidden bg-white shadow-xs outline outline-border"
              style={{
                width: board.width * scale,
                height: board.height * scale,
                borderRadius: board.cornerRadius && board.cornerRadius * scale,
              }}
            >
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{ width: board.width, height: board.height, transform: `scale(${scale})` }}
              >
                {children}
              </div>
              {!playback && pickingText && onPickText && (
                <button
                  ref={pickSurface}
                  type="button"
                  aria-label={toolLabel('选择要编辑的文字')}
                  className="absolute inset-0 touch-manipulation cursor-text bg-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    setPickingText(false)
                    editTrigger.current?.focus({ preventScroll: true })
                  }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const anchor =
                      event.detail === 0
                        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                        : { x: event.clientX, y: event.clientY }
                    const point = pointInBoard(board, rect, anchor)
                    if (!point) return
                    setPickingText(false)
                    editTrigger.current?.focus({ preventScroll: true })
                    onPickText(point, anchor)
                  }}
                />
              )}
            </div>
          </div>
        </ScrollArea>
      </div>
    </section>
  )
}
