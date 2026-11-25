import type { ArtifactType, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { SearchInput } from '@akasha/ui/input'
import { ChevronDown, LayoutGrid, List, Star } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel } from '@/shared/lib/format'
import { useLibraryView } from './library-view'
import { messages } from './messages'

interface FilterMenuProps {
  label: string
  summary: string
  value: string
  children: ReactNode
}

function FilterMenu({ label, summary, value, children }: FilterMenuProps) {
  const { dir } = useMessages(messages)
  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="max-w-full"
          aria-label={label}
          rightIcon={<ChevronDown size={14} />}
        >
          <span className="truncate">{summary}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value}>{children}</DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface LibraryToolbarProps {
  projects: readonly Project[]
  types: readonly ArtifactType[]
  /** 账户未登录或读取个人收藏失败时不提供收藏筛选。 */
  favoritesAvailable: boolean
}

/** 库页只提供一个搜索输入框，键盘快捷键与点按共用其当前查询。 */
export function LibraryToolbar({ projects, types, favoritesAvailable }: LibraryToolbarProps) {
  const { t, locale } = useMessages(messages)
  const searchRef = useRef<HTMLInputElement>(null)
  const search = useLibraryView((state) => state.search)
  const type = useLibraryView((state) => state.type)
  const favoritesOnly = useLibraryView((state) => state.favoritesOnly)
  const order = useLibraryView((state) => state.order)
  const layout = useLibraryView((state) => state.layout)
  const currentProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const setProject = useWorkspaceStore((state) => state.setSelectedProjectId)
  const currentProject = projects.find((item) => item.id === currentProjectId)

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <section aria-label={t('搜索与筛选')} className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-52">
        <SearchInput
          ref={searchRef}
          aria-label={t('搜索作品')}
          placeholder={t('搜索作品')}
          clearLabel={t('清除搜索')}
          controlSize="sm"
          shortcut={['mod', 'K']}
          value={search}
          onValueChange={(value) => useLibraryView.setState({ search: value })}
        />
      </div>
      <FilterMenu
        label={t('筛选项目')}
        summary={currentProject?.name ?? t('全部项目')}
        value={currentProjectId ?? ''}
      >
        <DropdownMenuRadioItem value="" onSelect={() => setProject(null)}>
          {t('全部项目')}
        </DropdownMenuRadioItem>
        {projects.map((item) => (
          <DropdownMenuRadioItem key={item.id} value={item.id} onSelect={() => setProject(item.id)}>
            <bdi>{item.name}</bdi>
          </DropdownMenuRadioItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label={t('筛选类型')}
        summary={type === 'all' ? t('全部类型') : artifactTypeLabel(type, locale)}
        value={type}
      >
        <DropdownMenuRadioItem
          value="all"
          onSelect={() => useLibraryView.setState({ type: 'all' })}
        >
          {t('全部类型')}
        </DropdownMenuRadioItem>
        {types.map((item) => (
          <DropdownMenuRadioItem
            key={item}
            value={item}
            onSelect={() => useLibraryView.setState({ type: item })}
          >
            {artifactTypeLabel(item, locale)}
          </DropdownMenuRadioItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label={t('排序方式')}
        summary={order === 'recent' ? t('最近更新') : t('按标题')}
        value={order}
      >
        <DropdownMenuRadioItem
          value="recent"
          onSelect={() => useLibraryView.setState({ order: 'recent' })}
        >
          {t('最近更新')}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="title"
          onSelect={() => useLibraryView.setState({ order: 'title' })}
        >
          {t('按标题')}
        </DropdownMenuRadioItem>
      </FilterMenu>
      {favoritesAvailable ? (
        <Button
          size="sm"
          variant={favoritesOnly ? 'secondary' : 'outline'}
          aria-pressed={favoritesOnly}
          leftIcon={<Star size={14} />}
          onClick={() => useLibraryView.setState({ favoritesOnly: !favoritesOnly })}
        >
          {t('仅收藏')}
        </Button>
      ) : null}
      <fieldset className="ms-auto flex items-center gap-1">
        <legend className="sr-only">{t('显示方式')}</legend>
        <Button
          size="sm"
          variant={layout === 'cards' ? 'secondary' : 'ghost'}
          aria-pressed={layout === 'cards'}
          leftIcon={<LayoutGrid size={14} />}
          onClick={() => useLibraryView.setState({ layout: 'cards' })}
        >
          {t('卡片')}
        </Button>
        <Button
          size="sm"
          variant={layout === 'list' ? 'secondary' : 'ghost'}
          aria-pressed={layout === 'list'}
          leftIcon={<List size={14} />}
          onClick={() => useLibraryView.setState({ layout: 'list' })}
        >
          {t('列表')}
        </Button>
      </fieldset>
    </section>
  )
}
