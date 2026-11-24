import { Button } from '@akasha/ui/button'
import { SearchInput } from '@akasha/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import {
  ChevronDown,
  Focus,
  Frame,
  Hand,
  Layers,
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
import { type ReactNode, useMemo, useState } from 'react'
import type { CanvasPage } from '@/entities/artifact'
import { DRAWING_TOOLS, type DrawingTool } from './BoardDrawingSurface'
import { CanvasPageActions, type CanvasPageEditing } from './CanvasPageActions'
import type { Camera } from './canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

const ZOOM_STEP = 1.25

/** 画布页面导航：搜索并切换页面与画板，给出当前页面的链接。 */
export function PageNavigator({
  open,
  onOpenChange,
  pages,
  page,
  selected,
  pageLink,
  onNavigate,
  status,
  onStatus,
  pageEditing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pages: readonly CanvasPage[]
  page: CanvasPage | undefined
  selected: string | null
  pageLink: (pageId: string) => string
  onNavigate: (page: CanvasPage, boardId?: string) => void
  status: string
  onStatus: (status: string) => void
  /** 只在可保存画布页面的头版本传入。 */
  pageEditing?: CanvasPageEditing
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => {
    if (!open) return null
    const search = query.trim().toLocaleLowerCase()
    const matches = (text: string) => text.toLocaleLowerCase().includes(search)
    return pages.flatMap((entry) => {
      const pageMatch = matches(entry.title)
      const boards = pageMatch ? entry.boards : entry.boards.filter((board) => matches(board.title))
      return pageMatch || boards.length ? [{ entry, boards }] : []
    })
  }, [open, pages, query])
  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(pageLink(id))
      onStatus('已复制页面链接')
    } catch {
      onStatus('无法复制页面链接，请检查剪贴板权限')
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery('')
        onOpenChange(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label="页面与画板"
          leftIcon={<Layers size={15} />}
          rightIcon={<ChevronDown size={12} />}
          className="max-w-32 sm:max-w-56"
        >
          <span className="truncate">{page?.title ?? '页面与画板'}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="artifact-canvas-navigator">
        <SearchInput
          controlSize="sm"
          aria-label="搜索页面或画板"
          placeholder="搜索页面或画板"
          classNames={{ control: 'mb-2' }}
          value={query}
          onValueChange={setQuery}
        />
        <div className="artifact-canvas-nav-results">
          {results?.length === 0 ? (
            <p className="p-2 text-sm text-ink-muted">没有匹配的页面或画板</p>
          ) : null}
          {results?.map(({ entry, boards }) => (
            <div key={entry.id} className="mb-2">
              <Button
                variant="ghost"
                size="sm"
                className="artifact-canvas-nav-item"
                aria-current={entry.id === page?.id ? 'page' : undefined}
                onClick={() => {
                  setQuery('')
                  onNavigate(entry)
                }}
              >
                {entry.title}
              </Button>
              {boards.map((board) => (
                <Button
                  key={board.id}
                  variant="ghost"
                  size="sm"
                  className="artifact-canvas-nav-item"
                  aria-pressed={entry.id === page?.id && board.id === selected}
                  onClick={() => {
                    setQuery('')
                    onNavigate(entry, board.id)
                  }}
                >
                  {board.title}
                </Button>
              ))}
            </div>
          ))}
        </div>
        <div className="border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!page}
            onClick={() => {
              if (page) void copyLink(page.id)
            }}
          >
            复制页面链接
          </Button>
          {pageEditing ? (
            <CanvasPageActions
              editing={pageEditing}
              page={page}
              pages={pages}
              onNavigate={onNavigate}
            />
          ) : null}
          <p role="status" className="px-2 text-xs text-ink-muted">
            {status}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

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
      <section aria-label="画布缩放" className="artifact-canvas-zoom">
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
