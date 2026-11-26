import { Button } from '@akasha/ui/button'
import { ListHighlight, ListHighlightItem } from '@akasha/ui/list-highlight'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import {
  Check,
  ChevronDown,
  Focus,
  Frame,
  Hand,
  Maximize,
  MessageCircle,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Shapes,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import type { CanvasBoardEditing } from '../hooks/useCanvasBoardEditing'
import type { Camera } from '../lib/canvas-camera'
import { acceptsCanvasShortcut } from '../lib/canvas-keyboard'
import { DRAWING_TOOLS, type DrawingTool } from '../ui/BoardDrawingSurface'
import { canvasToolsMessages } from './canvas-tools-messages'

const ZOOM_STEP = 1.25
const toolsByKey = new Map(
  Object.values(DRAWING_TOOLS).map((tool) => [tool.shortcut.toLowerCase(), tool]),
)

interface DrawingTools {
  value: DrawingTool | null
  change: (tool: DrawingTool) => void
  disabled: boolean
}

function DrawingButton({
  tools,
  tool,
  highlight = true,
}: {
  tools: DrawingTools
  tool: DrawingTool
  highlight?: boolean
}) {
  const { t } = useMessages(canvasToolsMessages)
  const button = (
    <Button
      variant={tools.value === tool ? 'primary' : 'ghost'}
      size="sm"
      iconOnly
      aria-label={t(tool.label)}
      title={`${t(tool.kind === 'stroke' ? '铅笔' : tool.label)} (${tool.shortcut})`}
      aria-keyshortcuts={tool.shortcut}
      aria-pressed={tools.value === tool}
      disabled={tools.disabled}
      onClick={() => tools.change(tool)}
    >
      <tool.icon size={15} />
    </Button>
  )
  return highlight ? <ListHighlightItem>{button}</ListHighlightItem> : button
}

function IslandDivider() {
  return <span aria-hidden="true" className="mx-0.5 h-3.5 w-px shrink-0 bg-border/90" />
}

/** 画布工具栏与相机控制。 */
export function CanvasToolbar({
  camera,
  hand,
  onChangeTool,
  designTools,
  canZoom,
  onZoom,
  guidesVisible,
  onToggleGuides,
  onFitPage,
  onFitSelection,
  visualEditActive,
  artboardTool,
  onComment,
  history,
  arrangementMenu,
}: {
  camera: Camera
  hand: boolean
  onChangeTool: (hand: boolean) => void
  designTools?: DrawingTools
  canZoom: boolean
  onZoom: (factor: number) => void
  guidesVisible: boolean | undefined
  onToggleGuides: (() => void) | undefined
  onFitPage: (() => void) | undefined
  onFitSelection: (() => void) | undefined
  visualEditActive: boolean | undefined
  artboardTool?: { active: boolean; disabled: boolean; toggle: () => void }
  onComment: () => void
  history?: Pick<CanvasBoardEditing, 'undo' | 'redo'>
  arrangementMenu?: ReactNode
}) {
  const { t, number } = useMessages(canvasToolsMessages)
  const toolbar = useRef<HTMLElement>(null)
  const [pensOpen, setPensOpen] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      !acceptsCanvasShortcut(event, toolbar.current?.parentElement) ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return
    const key = /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : event.key.toLowerCase()
    let action: (() => void) | undefined
    if (event.shiftKey) {
      if (event.code === 'Digit1') action = onFitPage
      if (event.code === 'Digit2') action = onFitSelection
      if (key === 'g') action = onToggleGuides
    } else if (key === 'v') action = () => onChangeTool(false)
    else if (key === 'h') action = () => onChangeTool(true)
    else if (key === 'c') action = onComment
    else if ((key === 'a' || key === 'f') && artboardTool && !artboardTool.disabled)
      action = artboardTool.toggle
    else if (designTools && !designTools.disabled) {
      const tool = toolsByKey.get(key)
      if (tool) action = () => designTools.change(tool)
    }
    if (canZoom && (key === '+' || key === '=')) action = () => onZoom(ZOOM_STEP)
    if (canZoom && key === '-') action = () => onZoom(1 / ZOOM_STEP)
    if (action) {
      event.preventDefault()
      action()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])
  const [shapesOpen, setShapesOpen] = useState(false)
  const selectActive = !hand && !designTools?.value && !artboardTool?.active && !visualEditActive
  const shape = designTools?.value?.kind
  const penActive = shape === 'stroke' || shape === 'pen'
  const shapeActive = shape === 'rectangle' || shape === 'ellipse'
  const selectShape = (tool: DrawingTool) => {
    designTools?.change(tool)
    setShapesOpen(false)
  }
  return (
    <>
      <ListHighlight>
        <section aria-label={t('画布播放与缩放')} className="artifact-canvas-zoom">
          <ListHighlightItem>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t('缩小')}
              title={`${t('缩小画布')} (-)`}
              aria-keyshortcuts="-"
              disabled={!canZoom}
              onClick={() => onZoom(1 / ZOOM_STEP)}
            >
              <Minus size={14} />
            </Button>
          </ListHighlightItem>
          <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
            <PopoverTrigger asChild>
              <ListHighlightItem>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-1.5"
                  aria-label={t('缩放选项')}
                  title={t('缩放选项')}
                  rightIcon={<ChevronDown size={11} className="disclosure-chevron" />}
                >
                  <output
                    aria-label={t('画布缩放比例')}
                    className="min-w-9 text-center font-mono text-xs tabular-nums"
                  >
                    {number(camera.scale, { style: 'percent', maximumFractionDigits: 1 })}
                  </output>
                </Button>
              </ListHighlightItem>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-56 p-1.5"
              aria-label={t('缩放选项')}
            >
              <ListHighlight>
                <div className="artifact-canvas-list-menu space-y-0.5">
                  <ListHighlightItem active={camera.fit === 'page'}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="artifact-canvas-menu-item w-full"
                      leftIcon={<Maximize size={14} />}
                      aria-label={t('适应页面')}
                      aria-keyshortcuts="Shift+1"
                      aria-pressed={camera.fit === 'page'}
                      disabled={!onFitPage}
                      onClick={() => {
                        onFitPage?.()
                        setZoomOpen(false)
                      }}
                    >
                      <span className="truncate">{t('适应页面')}</span>
                      <kbd className="ms-auto shrink-0 font-mono text-[11px] text-ink-muted">
                        Shift+1
                      </kbd>
                    </Button>
                  </ListHighlightItem>
                  <ListHighlightItem active={camera.fit === 'board' && Boolean(onFitSelection)}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="artifact-canvas-menu-item w-full"
                      leftIcon={<Focus size={14} />}
                      aria-label={t('适应选区')}
                      aria-keyshortcuts="Shift+2"
                      aria-pressed={camera.fit === 'board' && Boolean(onFitSelection)}
                      disabled={!onFitSelection}
                      onClick={() => {
                        onFitSelection?.()
                        setZoomOpen(false)
                      }}
                    >
                      <span className="truncate">{t('适应选区')}</span>
                      <kbd className="ms-auto shrink-0 font-mono text-[11px] text-ink-muted">
                        Shift+2
                      </kbd>
                    </Button>
                  </ListHighlightItem>
                  <hr className="my-1 border-0 border-t border-border/75" />
                  <ListHighlightItem>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="artifact-canvas-menu-item w-full"
                      leftIcon={
                        <Check size={14} className={guidesVisible ? undefined : 'invisible'} />
                      }
                      aria-label={t('显示画板辅助线')}
                      aria-keyshortcuts="Shift+G"
                      aria-pressed={guidesVisible ?? false}
                      disabled={!onToggleGuides}
                      onClick={() => {
                        onToggleGuides?.()
                        setZoomOpen(false)
                      }}
                    >
                      <span className="truncate">{t('显示画板辅助线')}</span>
                      <kbd className="ms-auto shrink-0 font-mono text-[11px] text-ink-muted">
                        Shift+G
                      </kbd>
                    </Button>
                  </ListHighlightItem>
                </div>
              </ListHighlight>
            </PopoverContent>
          </Popover>
          <ListHighlightItem>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t('放大')}
              title={`${t('放大画布')} (+)`}
              aria-keyshortcuts="+"
              disabled={!canZoom}
              onClick={() => onZoom(ZOOM_STEP)}
            >
              <Plus size={14} />
            </Button>
          </ListHighlightItem>
        </section>
      </ListHighlight>
      <ListHighlight>
        <section ref={toolbar} aria-label={t('画布工具')} className="artifact-canvas-tools">
          <ListHighlightItem>
            <Button
              variant={selectActive ? 'primary' : 'ghost'}
              size="sm"
              iconOnly
              aria-label={t('选择')}
              title={`${t('选择')} (V)`}
              aria-keyshortcuts="V"
              aria-pressed={selectActive}
              onClick={() => onChangeTool(false)}
            >
              <MousePointer2 size={15} />
            </Button>
          </ListHighlightItem>
          <ListHighlightItem>
            <Button
              variant={hand ? 'primary' : 'ghost'}
              size="sm"
              iconOnly
              aria-label={t('抓手')}
              title={`${t('抓手（也可按住空格拖动）')} (H)`}
              aria-keyshortcuts="H"
              aria-pressed={hand}
              onClick={() => onChangeTool(true)}
            >
              <Hand size={15} />
            </Button>
          </ListHighlightItem>
          {designTools || artboardTool || arrangementMenu ? <IslandDivider /> : null}
          {designTools && <DrawingButton tools={designTools} tool={DRAWING_TOOLS.text} />}
          {artboardTool ? (
            <ListHighlightItem>
              <Button
                variant={artboardTool.active ? 'primary' : 'ghost'}
                size="sm"
                iconOnly
                aria-label={t('添加画板')}
                title={`${t('添加画板')} (A)`}
                aria-keyshortcuts="A"
                aria-pressed={artboardTool.active}
                disabled={artboardTool.disabled}
                onClick={artboardTool.toggle}
              >
                <Frame size={15} />
              </Button>
            </ListHighlightItem>
          ) : null}
          {designTools && (
            <>
              <DrawingButton tools={designTools} tool={DRAWING_TOOLS.note} />
              <ListHighlightItem>
                <fieldset
                  aria-label={t('选择绘图工具')}
                  className="artifact-canvas-split-tool"
                  data-active={penActive ? 'true' : undefined}
                  data-open={pensOpen ? 'true' : undefined}
                >
                  <DrawingButton
                    highlight={false}
                    tools={designTools}
                    tool={
                      designTools.value?.kind === 'pen' ? DRAWING_TOOLS.pen : DRAWING_TOOLS.stroke
                    }
                  />
                  <Popover open={pensOpen} onOpenChange={setPensOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant={penActive ? 'primary' : 'ghost'}
                        size="sm"
                        iconOnly
                        className="artifact-canvas-tool-caret px-0"
                        aria-label={t('选择绘图工具')}
                        title={t('选择绘图工具')}
                        disabled={designTools.disabled}
                      >
                        <ChevronDown size={10} className="disclosure-chevron" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      side="top"
                      sideOffset={8}
                      className="w-44 p-1.5"
                      aria-label={t('选择绘图工具')}
                    >
                      <ListHighlight>
                        <div className="artifact-canvas-list-menu space-y-0.5">
                          {[DRAWING_TOOLS.stroke, DRAWING_TOOLS.pen].map((pen) => (
                            <ListHighlightItem key={pen.kind} active={designTools.value === pen}>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="artifact-canvas-menu-item w-full"
                                leftIcon={<pen.icon size={14} />}
                                aria-keyshortcuts={pen.shortcut}
                                onClick={() => {
                                  designTools.change(pen)
                                  setPensOpen(false)
                                }}
                              >
                                <span className="truncate">
                                  {t(pen.kind === 'stroke' ? '铅笔' : '钢笔')} ({pen.shortcut})
                                </span>
                              </Button>
                            </ListHighlightItem>
                          ))}
                        </div>
                      </ListHighlight>
                    </PopoverContent>
                  </Popover>
                </fieldset>
              </ListHighlightItem>
              <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
                <PopoverTrigger asChild>
                  <ListHighlightItem>
                    <Button
                      variant={shapeActive ? 'primary' : 'ghost'}
                      size="sm"
                      iconOnly
                      aria-label={t('形状')}
                      title={t('形状')}
                      aria-pressed={shapeActive}
                      disabled={designTools.disabled}
                    >
                      <Shapes size={15} />
                    </Button>
                  </ListHighlightItem>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  sideOffset={8}
                  className="w-40 p-1.5"
                  aria-label={t('选择形状')}
                >
                  <ListHighlight>
                    <div className="artifact-canvas-list-menu space-y-0.5">
                      <ListHighlightItem active={shape === 'rectangle'}>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<DRAWING_TOOLS.rectangle.icon size={14} />}
                          aria-label={t('绘制矩形')}
                          aria-keyshortcuts="R"
                          title={`${t('绘制矩形')} (R)`}
                          className="artifact-canvas-menu-item w-full"
                          onClick={() => selectShape(DRAWING_TOOLS.rectangle)}
                        >
                          <span className="truncate">{t('绘制矩形')}</span>
                          <kbd className="ms-auto shrink-0 font-mono text-[11px] text-ink-muted">
                            R
                          </kbd>
                        </Button>
                      </ListHighlightItem>
                      <ListHighlightItem active={shape === 'ellipse'}>
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<DRAWING_TOOLS.ellipse.icon size={14} />}
                          aria-label={t('绘制椭圆')}
                          aria-keyshortcuts="O"
                          title={`${t('绘制椭圆')} (O)`}
                          className="artifact-canvas-menu-item w-full"
                          onClick={() => selectShape(DRAWING_TOOLS.ellipse)}
                        >
                          <span className="truncate">{t('绘制椭圆')}</span>
                          <kbd className="ms-auto shrink-0 font-mono text-[11px] text-ink-muted">
                            O
                          </kbd>
                        </Button>
                      </ListHighlightItem>
                    </div>
                  </ListHighlight>
                </PopoverContent>
              </Popover>
            </>
          )}
          {arrangementMenu}
          <IslandDivider />
          <ListHighlightItem>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={t('画布批注')}
              title={`${t('批注')} (C)`}
              aria-keyshortcuts="C"
              onClick={onComment}
            >
              <MessageCircle size={15} />
            </Button>
          </ListHighlightItem>
          {history ? (
            <>
              <IslandDivider />
              <fieldset aria-label={t('编辑历史')} className="flex items-center gap-0.5">
                <ListHighlightItem>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={t('撤销画布编辑')}
                    title={`${t('撤销画布编辑')} (Ctrl/⌘+Z)`}
                    aria-keyshortcuts="Control+Z Meta+Z"
                    disabled={!history.undo}
                    onClick={history.undo}
                  >
                    <Undo2 size={14} />
                  </Button>
                </ListHighlightItem>
                <ListHighlightItem>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={t('重做画布编辑')}
                    title={`${t('重做画布编辑')} (Ctrl/⌘+Shift+Z)`}
                    aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                    disabled={!history.redo}
                    onClick={history.redo}
                  >
                    <Redo2 size={14} />
                  </Button>
                </ListHighlightItem>
              </fieldset>
            </>
          ) : null}
        </section>
      </ListHighlight>
    </>
  )
}
