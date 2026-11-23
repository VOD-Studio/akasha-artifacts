import { Button } from '@akasha/ui/button'
import { SearchInput } from '@akasha/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import {
  ChevronDown,
  Focus,
  Hand,
  Layers,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
} from 'lucide-react'
import { useState } from 'react'
import { ElementPickerButton } from '../../features/element-picker/ElementPickerButton'
import { CanvasPageActions, type CanvasPageEditing } from './CanvasPageActions'
import type { Camera } from './canvas-camera'
import type { CanvasPage } from './canvas-model'

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
  const search = query.trim().toLocaleLowerCase()
  const matches = (text: string) => text.toLocaleLowerCase().includes(search)
  const results = pages.flatMap((entry) => {
    const pageMatch = matches(entry.title)
    const boards = pageMatch ? entry.boards : entry.boards.filter((board) => matches(board.title))
    return pageMatch || boards.length ? [{ entry, boards }] : []
  })
  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(pageLink(id))
      onStatus('已复制页面链接')
    } catch {
      onStatus('无法复制页面链接，请检查浏览器的剪贴板权限')
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
          {results.length === 0 ? (
            <p className="p-2 text-sm text-ink-muted">找不到匹配的页面或画板</p>
          ) : null}
          {results.map(({ entry, boards }) => (
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

/** 画布工具栏：切换抓手工具、缩放、适配页面或选区，以及指认与直改的开关。 */
export function CanvasToolbar({
  camera,
  hand,
  onChangeTool,
  canZoom,
  onZoom,
  onFitPage,
  onFitSelection,
  onStartPicker,
  visualEditActive,
  onToggleVisualEdit,
}: {
  camera: Camera
  hand: boolean
  onChangeTool: (hand: boolean) => void
  canZoom: boolean
  onZoom: (factor: number) => void
  onFitPage: (() => void) | undefined
  onFitSelection: (() => void) | undefined
  onStartPicker: () => void
  visualEditActive: boolean | undefined
  onToggleVisualEdit: () => void
}) {
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
      </section>
      <section aria-label="画布工具" className="artifact-canvas-tools">
        <Button
          variant={hand ? 'ghost' : 'secondary'}
          size="sm"
          iconOnly
          aria-label="选择"
          title="选择"
          aria-pressed={!hand}
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
        <ElementPickerButton onStart={onStartPicker} />
        {visualEditActive !== undefined ? (
          <Button
            variant={visualEditActive ? 'secondary' : 'ghost'}
            size="sm"
            leftIcon={<Pencil size={13} />}
            aria-pressed={visualEditActive}
            onClick={onToggleVisualEdit}
          >
            可视化直改
          </Button>
        ) : null}
      </section>
    </>
  )
}
