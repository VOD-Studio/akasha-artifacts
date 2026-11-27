import { Button } from '@akasha/ui/button'
import { ListHighlight, ListHighlightItem } from '@akasha/ui/list-highlight'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Segmented } from '@akasha/ui/segmented'
import { ArrowLeft, Download, Minus, PencilLine, Play, Plus } from 'lucide-react'
import {
  type MouseEventHandler,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CanvasBoard } from '@/entities/artifact'
import { useMessages } from '@/shared/i18n'
import { useViewportSize } from '../hooks/useViewportSize'
import { type Point, pointInBoard } from '../lib/canvas-camera'
import { acceptsCanvasShortcut } from '../lib/canvas-keyboard'
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
const KEYBOARD_CONTROL =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="button"]'
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

/** 聚焦和试玩共享固定画板视口；采用与总览一致的浮岛控件并保留缩放与视图快捷键。 */
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
  const [spacePanning, setSpacePanning] = useState(false)
  const [draggingPan, setDraggingPan] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const editTrigger = useRef<HTMLButtonElement>(null)
  const pickSurface = useRef<HTMLButtonElement>(null)
  const backRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
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

  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!visible || event.altKey || !acceptsCanvasShortcut(event, sectionRef.current)) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (
      !playback &&
      !mod &&
      event.code === 'Space' &&
      !(event.target instanceof Element && event.target.closest(KEYBOARD_CONTROL))
    ) {
      event.preventDefault()
      setSpacePanning(true)
      return
    }

    if (event.repeat && key !== '+' && key !== '=' && key !== '-') return

    let action: (() => void) | undefined
    if (event.shiftKey && !mod) {
      if (event.code === 'Digit1') action = () => setZoom('fit')
      else if (event.code === 'Digit2') action = () => setZoom('fill')
    } else if (key === '+' || key === '=') {
      action = () => setZoom(clampScale(scale * SCALE_STEP))
    } else if (key === '-') {
      action = () => setZoom(clampScale(scale / SCALE_STEP))
    } else if (key === '0' && !event.shiftKey) {
      action = () => setZoom(1)
    }

    if (action) {
      event.preventDefault()
      action()
    }
  })

  const handleWheelZoom = useEffectEvent((event: WheelEvent) => {
    if (!visible || (!event.ctrlKey && !event.metaKey)) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0025)
    setZoom(clampScale(scale * factor))
  })

  useEffect(() => {
    if (!visible) return
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePanning(false)
    }
    const blur = () => {
      setSpacePanning(false)
      setDraggingPan(false)
    }
    window.addEventListener('keydown', handleShortcut)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', handleShortcut)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [visible])

  useEffect(() => {
    const surface = scrollRef.current
    if (!visible || !surface) return
    const onWheel = (event: WheelEvent) => handleWheelZoom(event)
    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [visible])

  const startSpacePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (playback || !spacePanning || event.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = viewport.scrollLeft
    const startTop = viewport.scrollTop
    setDraggingPan(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      viewport.scrollLeft = startLeft - (moveEvent.clientX - startX)
      viewport.scrollTop = startTop - (moveEvent.clientY - startY)
    }
    const onEnd = () => {
      setDraggingPan(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  let panCursorClass = ''
  if (!playback && draggingPan) panCursorClass = 'cursor-grabbing select-none'
  else if (!playback && spacePanning) panCursorClass = 'cursor-grab select-none'

  return (
    <section
      ref={sectionRef}
      dir={dir}
      hidden={!visible}
      aria-label={t(playback ? '交互预览' : '画板查看')}
      className={
        visible
          ? 'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas max-md:fixed max-md:inset-0 max-md:z-30 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]'
          : 'hidden'
      }
    >
      <div
        ref={scrollRef}
        dir="ltr"
        onPointerDown={startSpacePan}
        className={`artifact-canvas-surface min-h-0 min-w-0 flex-1 overflow-hidden ${panCursorClass}`}
      >
        <ScrollArea
          ref={viewportRef}
          dir="ltr"
          orientation="both"
          aria-label={t('画板内容')}
          tabIndex={-1}
          className="artifact-canvas-presentation-scroll h-full w-full overscroll-contain [--v-scroll-area-padding:0px]"
        >
          <div className="flex min-h-full min-w-max flex-1 px-6 py-16">
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
              aria-keyshortcuts="Escape"
              title={`${t(playback ? '退出预览' : '返回总览')} (Esc)`}
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
                  title: `${t('适应窗口')} (Shift+1)`,
                  render: (props, { active }) => (
                    <button
                      {...props}
                      type="button"
                      aria-keyshortcuts="Shift+1"
                      aria-pressed={active}
                    />
                  ),
                },
                {
                  value: 'fill',
                  label: t('填充宽度'),
                  title: `${t('填充宽度')} (Shift+2)`,
                  render: (props, { active }) => (
                    <button
                      {...props}
                      type="button"
                      aria-keyshortcuts="Shift+2"
                      aria-pressed={active}
                    />
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
                aria-keyshortcuts="-"
                title={`${t('缩小')} (-)`}
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
                aria-keyshortcuts="0"
                title={`${t('实际大小')} (0)`}
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
                aria-keyshortcuts="+"
                title={`${t('放大')} (+)`}
                disabled={scale >= 4}
                onClick={() => setZoom(clampScale(scale * SCALE_STEP))}
              >
                <Plus size={14} />
              </Button>
            </ListHighlightItem>
          </fieldset>

          {!playback && (onPickText || onExport || onPlay) ? <DockDivider /> : null}

          {!playback && onPickText ? (
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
          {!playback && onExport ? (
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
          {!playback && onPlay ? (
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
    </section>
  )
}
