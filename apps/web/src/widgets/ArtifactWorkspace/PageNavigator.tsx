import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { SearchInput } from '@akasha/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import {
  Check,
  ChevronDown,
  Ellipsis,
  File,
  Layers,
  Link,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { CanvasPage } from '@/entities/artifact'
import {
  CanvasPageDialog,
  type CanvasPageEditing,
  type PageActionRequest,
} from './CanvasPageDialog'

interface PageNavigatorProps {
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
}

interface PageMenuProps {
  page: CanvasPage
  canEdit: boolean
  onCopy: (pageId: string) => void
  onEdit: (kind: 'rename' | 'delete', page: CanvasPage, trigger: HTMLButtonElement) => void
}

function PageMenu({ page, canEdit, onCopy, onEdit }: PageMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const openingDialog = useRef(false)
  const edit = (kind: 'rename' | 'delete') => {
    if (!triggerRef.current) return
    openingDialog.current = true
    onEdit(kind, page, triggerRef.current)
  }
  const returnMenuFocus = (event: Event) => {
    if (openingDialog.current) event.preventDefault()
    openingDialog.current = false
  }
  const label = `更多页面操作：${page.title}`

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          iconOnly
          size="sm"
          aria-label={label}
          title={label}
        >
          <Ellipsis size={15} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={returnMenuFocus}>
        <DropdownMenuItem onSelect={() => onCopy(page.id)}>
          <Link />
          复制页面链接
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuItem onSelect={() => edit('rename')}>
              <Pencil />
              重命名页面
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => edit('delete')}>
              <Trash2 />
              删除页面
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 在同一列表中查找页面和画板；页面操作只作用于打开菜单的那一页。 */
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
}: PageNavigatorProps) {
  const [query, setQuery] = useState('')
  const [request, setRequest] = useState<PageActionRequest | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const actionOrigin = useRef<HTMLButtonElement | null>(null)
  const results = useMemo(() => {
    if (!open) return []
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
  const createPage = (trigger: HTMLButtonElement) => {
    if (!pageEditing) return
    actionOrigin.current = trigger
    setRequest({ kind: 'create', baseVersion: pageEditing.version.version })
  }
  const editPage: PageMenuProps['onEdit'] = (kind, target, trigger) => {
    if (!pageEditing) return
    actionOrigin.current = trigger
    setRequest({ kind, page: target, baseVersion: pageEditing.version.version })
  }
  const closeDialog = (saved?: PageActionRequest['kind']) => {
    // 保存响应可能早于列表刷新；不把焦点还给即将消失的菜单按钮。
    if (saved === 'delete' || (saved === 'rename' && query.trim())) actionOrigin.current = null
    setRequest(null)
  }
  const restoreFocus = () => {
    const origin = actionOrigin.current
    const target = origin?.isConnected ? origin : (searchRef.current ?? triggerRef.current)
    target?.focus({ preventScroll: true })
  }
  const navigate = (target: CanvasPage, boardId?: string) => {
    setQuery('')
    onNavigate(target, boardId)
  }
  const changeOpen = (next: boolean) => {
    if (!next) {
      setQuery('')
      onStatus('')
    }
    onOpenChange(next)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="secondary"
          size="sm"
          aria-label="页面与画板"
          leftIcon={<Layers size={15} />}
          rightIcon={<ChevronDown size={12} />}
          className="artifact-canvas-nav-trigger max-w-32 sm:max-w-56"
        >
          <span className="truncate" dir="auto">
            {page?.title ?? '页面与画板'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="artifact-canvas-navigator">
        <SearchInput
          ref={searchRef}
          controlSize="sm"
          aria-label="搜索页面或画板"
          placeholder="搜索页面或画板"
          value={query}
          onValueChange={setQuery}
        />
        <div className="artifact-canvas-nav-results">
          {results.length === 0 && (
            <p className="p-2 text-sm text-ink-muted">没有匹配的页面或画板</p>
          )}
          {results.map(({ entry, boards }) => (
            <fieldset key={entry.id} aria-label={entry.title} className="min-w-0 not-first:mt-2">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="artifact-canvas-nav-item min-w-0 flex-1"
                  leftIcon={<File size={14} />}
                  aria-current={entry.id === page?.id ? 'page' : undefined}
                  title={entry.title}
                  onClick={() => navigate(entry)}
                >
                  <bdi>{entry.title}</bdi>
                </Button>
                <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                  {entry.boards.length} 张画板
                </span>
                <PageMenu
                  page={entry}
                  canEdit={Boolean(pageEditing) && entry.ownedBoardCount !== undefined}
                  onCopy={copyLink}
                  onEdit={editPage}
                />
              </div>
              {boards.map((board) => {
                const active = entry.id === page?.id && board.id === selected
                return (
                  <Button
                    key={board.id}
                    variant="ghost"
                    size="sm"
                    className="artifact-canvas-nav-item w-full"
                    rightIcon={active && <Check size={14} />}
                    aria-pressed={active}
                    title={board.title}
                    onClick={() => navigate(entry, board.id)}
                  >
                    <bdi>{board.title}</bdi>
                  </Button>
                )
              })}
            </fieldset>
          ))}
        </div>
        {pageEditing && (
          <div className="border-t border-border pt-2">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Plus size={15} />}
              onClick={(event) => createPage(event.currentTarget)}
            >
              新建页面
            </Button>
          </div>
        )}
        <p role="status" className="px-2 text-xs text-ink-muted empty:sr-only">
          {status}
        </p>
        {pageEditing && request && (
          <CanvasPageDialog
            request={request}
            editing={pageEditing}
            currentPageId={page?.id}
            pages={pages}
            onNavigate={navigate}
            onClose={closeDialog}
            restoreFocus={restoreFocus}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}
