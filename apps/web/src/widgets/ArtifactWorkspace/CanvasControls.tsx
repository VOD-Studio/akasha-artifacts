import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import {
  Focus,
  Frame,
  Hand,
  Maximize,
  MessageCircle,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Shapes,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { DRAWING_TOOLS, type DrawingTool } from './BoardDrawingSurface'
import type { Camera } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

const ZOOM_STEP = 1.25

interface DrawingTools {
  value: DrawingTool | null
  change: (tool: DrawingTool) => void
  disabled: boolean
}

function DrawingButton({ tools, tool }: { tools: DrawingTools; tool: DrawingTool }) {
  return (
    <Button
      variant={tools.value === tool ? 'secondary' : 'ghost'}
      size="sm"
      iconOnly
      aria-label={tool.label}
      title={tool.label}
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
  onFitPage,
  onFitSelection,
  visualEditActive,
  onToggleVisualEdit,
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
  onFitPage: (() => void) | undefined
  onFitSelection: (() => void) | undefined
  visualEditActive: boolean | undefined
  onToggleVisualEdit: () => void
  onAddBoard?: () => void
  canAddBoard?: boolean
  onComment: () => void
  history?: Pick<CanvasBoardEditing, 'undo' | 'redo'>
  arrangementMenu?: ReactNode
  playbackMenu?: ReactNode
}) {
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
      <section aria-label="画布播放与缩放" className="artifact-canvas-zoom">
        {playbackMenu}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="适应页面"
          title="适应页面"
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
          aria-label="适应选区"
          title="适应选区"
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
          aria-label="缩小"
          title="缩小画布"
          disabled={!canZoom}
          onClick={() => onZoom(1 / ZOOM_STEP)}
        >
          <Minus size={15} />
        </Button>
        <output aria-label="画布缩放比例" className="min-w-10 text-center text-xs tabular-nums">
          {Math.round(camera.scale * 1000) / 10}%
        </output>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="放大"
          title="放大画布"
          disabled={!canZoom}
          onClick={() => onZoom(ZOOM_STEP)}
        >
          <Plus size={15} />
        </Button>
        {arrangementMenu}
        {history ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="撤销画布编辑"
              title="撤销画布编辑"
              disabled={!history.undo}
              onClick={history.undo}
            >
              <Undo2 size={15} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="重做画布编辑"
              title="重做画布编辑"
              disabled={!history.redo}
              onClick={history.redo}
            >
              <Redo2 size={15} />
            </Button>
          </>
        ) : null}
      </section>
      <section aria-label="画布工具" className="artifact-canvas-tools">
        <Button
          variant={selectActive ? 'secondary' : 'ghost'}
          size="sm"
          iconOnly
          aria-label="选择"
          title="选择"
          aria-pressed={selectActive}
          onClick={() => onChangeTool(false)}
        >
          <MousePointer2 size={15} />
        </Button>
        <Button
          variant={hand ? 'secondary' : 'ghost'}
          size="sm"
          iconOnly
          aria-label="抓手"
          title="抓手（也可按住空格拖动）"
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
            aria-label="添加画板"
            title="添加画板"
            disabled={!canAddBoard}
            onClick={onAddBoard}
          >
            <Frame size={15} />
          </Button>
        ) : null}
        {designTools && (
          <>
            <DrawingButton tools={designTools} tool={DRAWING_TOOLS.note} />
            <DrawingButton tools={designTools} tool={DRAWING_TOOLS.stroke} />
            <Popover open={shapesOpen} onOpenChange={setShapesOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant={shapeActive ? 'secondary' : 'ghost'}
                  size="sm"
                  iconOnly
                  aria-label="形状"
                  title="形状"
                  aria-pressed={shapeActive}
                  disabled={designTools.disabled}
                >
                  <Shapes size={15} />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-36 p-1" aria-label="选择形状">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<DRAWING_TOOLS.rectangle.icon size={15} />}
                  className="w-full justify-start"
                  onClick={() => selectShape(DRAWING_TOOLS.rectangle)}
                >
                  绘制矩形
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<DRAWING_TOOLS.ellipse.icon size={15} />}
                  className="w-full justify-start"
                  onClick={() => selectShape(DRAWING_TOOLS.ellipse)}
                >
                  绘制椭圆
                </Button>
              </PopoverContent>
            </Popover>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="画布批注"
          title="批注"
          onClick={onComment}
        >
          <MessageCircle size={15} />
        </Button>
        {visualEditActive !== undefined ? (
          <Button
            variant={visualEditActive ? 'secondary' : 'ghost'}
            size="sm"
            leftIcon={<Pencil size={13} />}
            aria-pressed={visualEditActive}
            onClick={onToggleVisualEdit}
          >
            编辑元素
          </Button>
        ) : null}
      </section>
    </>
  )
}
