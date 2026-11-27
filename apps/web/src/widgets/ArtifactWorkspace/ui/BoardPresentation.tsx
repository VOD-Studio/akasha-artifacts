import { Button } from '@akasha/ui/button'
import { ListHighlight, ListHighlightItem } from '@akasha/ui/list-highlight'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Segmented } from '@akasha/ui/segmented'
import { ArrowLeft, Download, Minus, PencilLine, Play, Plus } from 'lucide-react'
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
const VIEWPORT_PADDING_X = 48
const VIEWPORT_PADDING_Y = 128
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

function DockDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/90" />
}

/** 聚焦和试玩共享固定画板视口；采用与总览一致的浮岛控件，避免双层通栏顶栏割裂画面。 */
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
  const widthScale = Math.max(1, size.width - VIEWPORT_PADDING_X) / board.width
  const heightScale = Math.max(1, size.height - VIEWPORT_PADDING_Y) / board.height
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
          ? 'relative flex min-h-0 min-w-0 flex-1 flex-col bg-canvas max-md:fixed max-md:inset-0 max-md:z-30 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]'
          : 'hidden'
      }
    >
      <div
        ref={scrollRef}
        dir="ltr"
        className="artifact-canvas-surface min-h-0 flex-1 overflow-hidden"
      >
        <ScrollArea
          dir="ltr"
          orientation="both"
          aria-label={t('画板内容')}
          tabIndex={-1}
          className="h-full w-full overscroll-contain [--v-scroll-area-padding:0px]"
        >
          <div className="flex min-h-full min-w-max px-6 py-16">
            <div
              className="relative m-auto shrink-0 overflow-hidden bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_32px_-12px_rgba(0,0,0,0.12)] ring-1 ring-border/80"
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

      <ListHighlight>
        <header className="artifact-canvas-presentation-header">
          <ListHighlightItem>
            <Button
              ref={backRef}
              variant="ghost"
              size="sm"
              className="shrink-0 gap-1.5 px-2 text-xs text-ink"
              leftIcon={<ArrowLeft size={14} className="rtl:rotate-180" />}
              onClick={onClose}
            >
              {t(playback ? '退出预览' : '返回总览')}
            </Button>
          </ListHighlightItem>
          <DockDivider />
          <h2
            dir="auto"
            title={board.title}
            className="max-w-52 min-w-0 truncate px-2 text-[13px] font-medium text-ink sm:max-w-80"
          >
            {board.title}
          </h2>
        </header>
      </ListHighlight>

      {!playback && pickingText && onPickText ? (
        <div className="artifact-canvas-notices">
          <span
            role="status"
            className="rounded-full border border-(--ol) bg-card/94 px-3 py-1 text-xs text-ink shadow-(--shadow-float) backdrop-blur-lg"
          >
            {toolLabel('选择要编辑的文字')}
          </span>
        </div>
      ) : null}

      {!playback ? (
        <ListHighlight>
          <div className="artifact-canvas-presentation-dock">
            <fieldset className="flex shrink-0 items-center gap-0.5">
              <legend className="sr-only">{t('画板缩放')}</legend>
              <Segmented
                size="sm"
                rounded="md"
                aria-label={t('画板缩放')}
                className="[--v-segmented-block:1.75rem] [--v-segmented-font-size:0.75rem] [--v-segmented-item-pad:0.5rem]"
                value={typeof zoom === 'string' ? zoom : ''}
                onValueChange={(next) => {
                  if (next === 'fit' || next === 'fill') setZoom(next)
                }}
                segments={[
                  {
                    value: 'fit',
                    label: t('适应窗口'),
                    render: (props, { active }) => (
                      <button {...props} type="button" aria-pressed={active} />
                    ),
                  },
                  {
                    value: 'fill',
                    label: t('填充宽度'),
                    render: (props, { active }) => (
                      <button {...props} type="button" aria-pressed={active} />
                    ),
                  },
                ]}
              />
              <DockDivider />
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={t('缩小')}
                  title={t('缩小')}
                  disabled={scale <= 0.001}
                  onClick={() => setZoom(clampScale(scale / SCALE_STEP))}
                >
                  <Minus size={14} />
                </Button>
              </ListHighlightItem>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-1.5"
                  aria-label={t('实际大小')}
                  title={t('实际大小')}
                  onClick={() => setZoom(1)}
                >
                  <output
                    aria-label={t('画板缩放比例')}
                    className="min-w-10 text-center font-mono text-xs tabular-nums"
                  >
                    {number(scale, { style: 'percent', maximumFractionDigits: 1 })}
                  </output>
                </Button>
              </ListHighlightItem>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label={t('放大')}
                  title={t('放大')}
                  disabled={scale >= 4}
                  onClick={() => setZoom(clampScale(scale * SCALE_STEP))}
                >
                  <Plus size={14} />
                </Button>
              </ListHighlightItem>
            </fieldset>

            {onPickText || onExport || onPlay ? <DockDivider /> : null}

            {onPickText ? (
              <ListHighlightItem>
                <Button
                  ref={editTrigger}
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 px-2.5 text-xs"
                  data-active={pickingText ? 'true' : undefined}
                  aria-pressed={pickingText}
                  leftIcon={<PencilLine size={13} />}
                  onClick={() => setPickingText(!pickingText)}
                >
                  {toolLabel('编辑文字')}
                </Button>
              </ListHighlightItem>
            ) : null}
            {onExport ? (
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 px-2.5 text-xs"
                  leftIcon={<Download size={13} />}
                  onClick={onExport}
                >
                  {t('导出画板')}
                </Button>
              </ListHighlightItem>
            ) : null}
            {onPlay ? (
              <Button
                variant="primary"
                size="sm"
                className="gap-1.5 px-2.5 text-xs"
                leftIcon={<Play size={13} />}
                aria-label={t('播放原型：{title}', { title: board.title })}
                onClick={onPlay}
              >
                {t('播放原型')}
              </Button>
            ) : null}
          </div>
        </ListHighlight>
      ) : null}
    </section>
  )
}
