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
import { useWorkspaceStore } from '../../entities/workspace/store'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'
import { useLibraryView } from './library-view'

interface FilterMenuProps {
  label: string
  summary: string
  value: string
  children: ReactNode
}

function FilterMenu({ label, summary, value, children }: FilterMenuProps) {
  return (
    <DropdownMenu>
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
    function focusSearch(event: KeyboardEvent) {
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
    <section aria-label="搜索和筛选制品" className="flex flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-52">
        <SearchInput
          ref={searchRef}
          aria-label="搜索制品"
          placeholder="按标题、项目或关键词搜索"
          controlSize="sm"
          shortcut={['mod', 'K']}
          value={search}
          onValueChange={(value) => useLibraryView.setState({ search: value })}
        />
      </div>
      <FilterMenu
        label="筛选项目"
        summary={currentProject?.name ?? '全部项目'}
        value={currentProjectId ?? ''}
      >
        <DropdownMenuRadioItem value="" onSelect={() => setProject(null)}>
          全部项目
        </DropdownMenuRadioItem>
        {projects.map((item) => (
          <DropdownMenuRadioItem key={item.id} value={item.id} onSelect={() => setProject(item.id)}>
            {item.name}
          </DropdownMenuRadioItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label="筛选类型"
        summary={type === 'all' ? '全部类型' : ARTIFACT_TYPE_LABELS[type]}
        value={type}
      >
        <DropdownMenuRadioItem
          value="all"
          onSelect={() => useLibraryView.setState({ type: 'all' })}
        >
          全部类型
        </DropdownMenuRadioItem>
        {types.map((item) => (
          <DropdownMenuRadioItem
            key={item}
            value={item}
            onSelect={() => useLibraryView.setState({ type: item })}
          >
            {ARTIFACT_TYPE_LABELS[item]}
          </DropdownMenuRadioItem>
        ))}
      </FilterMenu>
      <FilterMenu
        label="排序方式"
        summary={order === 'recent' ? '最近更新' : '按标题'}
        value={order}
      >
        <DropdownMenuRadioItem
          value="recent"
          onSelect={() => useLibraryView.setState({ order: 'recent' })}
        >
          最近更新
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem
          value="title"
          onSelect={() => useLibraryView.setState({ order: 'title' })}
        >
          按标题
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
          仅收藏
        </Button>
      ) : null}
      <fieldset className="ml-auto flex items-center gap-1">
        <legend className="sr-only">制品显示方式</legend>
        <Button
          size="sm"
          variant={layout === 'cards' ? 'secondary' : 'ghost'}
          aria-pressed={layout === 'cards'}
          leftIcon={<LayoutGrid size={14} />}
          onClick={() => useLibraryView.setState({ layout: 'cards' })}
        >
          卡片
        </Button>
        <Button
          size="sm"
          variant={layout === 'list' ? 'secondary' : 'ghost'}
          aria-pressed={layout === 'list'}
          leftIcon={<List size={14} />}
          onClick={() => useLibraryView.setState({ layout: 'list' })}
        >
          列表
        </Button>
      </fieldset>
    </section>
  )
}
