import { Button } from '@akasha/ui/button'
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

function DrawingButton({ tools, tool }: { tools: DrawingTools; tool: DrawingTool }) {
  const { t } = useMessages(canvasToolsMessages)
  return (
    <Button
      variant={tools.value === tool ? 'secondary' : 'ghost'}
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
  onAddBoard,
  canAddBoard,
  onComment,
  history,
  arrangementMenu,
  playbackMenu,
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
  onAddBoard?: () => void
  canAddBoard?: boolean
  onComment: () => void
  history?: Pick<CanvasBoardEditing, 'undo' | 'redo'>
  arrangementMenu?: ReactNode
  playbackMenu?: ReactNode
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
    else if (key === 'f' && canAddBoard) action = onAddBoard
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
  const selectActive = !hand && !designTools?.value && !visualEditActive
  const shape = designTools?.value?.kind
  const shapeActive = shape === 'rectangle' || shape === 'ellipse'
  const selectShape = (tool: DrawingTool) => {
    designTools?.change(tool)
    setShapesOpen(false)
  }
  return (
    <>
      <section aria-label={t('画布播放与缩放')} className="artifact-canvas-zoom">
        {playbackMenu}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('适应页面')}
          title={`${t('适应页面')} (Shift+1)`}
          aria-keyshortcuts="Shift+1"
          aria-pressed={camera.fit === 'page'}
          disabled={!onFitPage}
          onClick={onFitPage}
        >
          <Maximize size={15} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('适应选区')}
          title={`${t('适应选区')} (Shift+2)`}
          aria-keyshortcuts="Shift+2"
          aria-pressed={camera.fit === 'board' && Boolean(onFitSelection)}
          disabled={!onFitSelection}
          onClick={onFitSelection}
        >
          <Focus size={15} />
        </Button>
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
          <Minus size={15} />
        </Button>
        <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('缩放选项')}
              title={t('缩放选项')}
              rightIcon={<ChevronDown size={12} />}
            >
              <output aria-label={t('画布缩放比例')} className="text-center text-xs tabular-nums">
                {number(camera.scale, { style: 'percent', maximumFractionDigits: 1 })}
              </output>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-1" aria-label={t('缩放选项')}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Check size={15} className={guidesVisible ? undefined : 'invisible'} />}
              aria-label={t('显示画板辅助线')}
              aria-keyshortcuts="Shift+G"
              aria-pressed={guidesVisible ?? false}
              disabled={!onToggleGuides}
              onClick={() => {
                onToggleGuides?.()
                setZoomOpen(false)
              }}
            >
              {t('显示画板辅助线')}
              <kbd className="text-xs text-ink-muted">Shift+G</kbd>
            </Button>
          </PopoverContent>
        </Popover>
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
          <Plus size={15} />
        </Button>
        {arrangementMenu}
        {history ? (
          <fieldset aria-label={t('编辑历史')} className="flex items-center">
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
              <Undo2 size={15} />
            </Button>
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
              <Redo2 size={15} />
            </Button>
          </fieldset>
        ) : null}
      </section>
      <section ref={toolbar} aria-label={t('画布工具')} className="artifact-canvas-tools">
        <Button
          variant={selectActive ? 'secondary' : 'ghost'}
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
        <Button
          variant={hand ? 'secondary' : 'ghost'}
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
        {designTools && <DrawingButton tools={designTools} tool={DRAWING_TOOLS.text} />}
        {onAddBoard ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('添加画板')}
            title={`${t('添加画板')} (F)`}
            aria-keyshortcuts="F"
            disabled={!canAddBoard}
            onClick={onAddBoard}
          >
            <Frame size={15} />
          </Button>
        ) : null}
        {designTools && (
          <>
            <DrawingButton tools={designTools} tool={DRAWING_TOOLS.note} />
            <fieldset aria-label={t('选择绘图工具')} className="flex items-center">
              <DrawingButton
                tools={designTools}
                tool={designTools.value?.kind === 'pen' ? DRAWING_TOOLS.pen : DRAWING_TOOLS.stroke}
              />
              <Popover open={pensOpen} onOpenChange={setPensOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={t('选择绘图工具')}
                    title={t('选择绘图工具')}
                    disabled={designTools.disabled}
                  >
                    <ChevronDown size={12} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent side="top" className="w-40 p-1" aria-label={t('选择绘图工具')}>
                  {[DRAWING_TOOLS.stroke, DRAWING_TOOLS.pen].map((pen) => (
                    <Button
                      key={pen.kind}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start"
                      leftIcon={<pen.icon size={15} />}
                      aria-keyshortcuts={pen.shortcut}
                      onClick={() => {
                        designTools.change(pen)
                        setPensOpen(false)
                      }}
                    >
                      {t(pen.kind === 'stroke' ? '铅笔' : '钢笔')} ({pen.shortcut})
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            </fieldset>
            <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={shapeActive ? 'secondary' : 'ghost'}
                  size="sm"
                  iconOnly
                  aria-label={t('形状')}
                  title={t('形状')}
                  aria-pressed={shapeActive}
                  disabled={designTools.disabled}
                >
                  <Shapes size={15} />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-36 p-1" aria-label={t('选择形状')}>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<DRAWING_TOOLS.rectangle.icon size={15} />}
                  aria-keyshortcuts="R"
                  title={`${t('绘制矩形')} (R)`}
                  className="w-full justify-start"
                  onClick={() => selectShape(DRAWING_TOOLS.rectangle)}
                >
                  {t('绘制矩形')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<DRAWING_TOOLS.ellipse.icon size={15} />}
                  aria-keyshortcuts="O"
                  title={`${t('绘制椭圆')} (O)`}
                  className="w-full justify-start"
                  onClick={() => selectShape(DRAWING_TOOLS.ellipse)}
                >
                  {t('绘制椭圆')}
                </Button>
              </PopoverContent>
            </Popover>
          </>
        )}
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
      </section>
    </>
  )
}
