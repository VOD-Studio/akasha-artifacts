import type { ArtifactType, Project } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { Segmented } from '@akasha/ui/segmented'
import { ArrowUpDown, ChevronDown, LayoutGrid, List, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { artifactTypeLabel } from '@/shared/lib/format'
import { messages } from '../messages'
import { useLibraryView } from '../model/library-view'

const MAX_INLINE_PROJECTS = 4

interface FilterMenuProps {
  label: string
  summary: string
  value: string
  icon?: ReactNode
  children: ReactNode
}

function FilterMenu({ label, summary, value, icon, children }: FilterMenuProps) {
  const { dir } = useMessages(messages)
  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="max-w-44 text-ink-muted hover:text-ink"
          aria-label={label}
          leftIcon={icon}
          rightIcon={<ChevronDown size={13} className="disclosure-chevron" />}
        >
          <span className="truncate">{summary}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value}>{children}</DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ScopeButtonProps {
  active: boolean
  label: string
  icon?: ReactNode
  muted?: boolean
  onClick: () => void
}

/** 选中与未选中复用同一 Button 尺寸与字重，避免切换范围时产生横向抖动。 */
function ScopeButton({ active, label, icon, muted = false, onClick }: ScopeButtonProps) {
  let toneClass = 'text-ink-muted hover:text-ink'
  if (active) {
    toneClass = ''
  } else if (muted) {
    toneClass = 'text-ink-muted/70 hover:text-ink'
  }
  return (
    <Button
      variant={active ? 'primary' : 'ghost'}
      size="sm"
      aria-pressed={active}
      leftIcon={icon}
      onClick={onClick}
      className={toneClass}
    >
      <bdi className="max-w-36 truncate">{label}</bdi>
    </Button>
  )
}

interface LibraryToolbarProps {
  projects: readonly Project[]
  types: readonly ArtifactType[]
  /** 账户未登录或读取个人收藏失败时不提供收藏筛选。 */
  favoritesAvailable: boolean
}

/** 范围直达栏与排序、视图切换；选中态保持几何稳定，不改变文字宽度。 */
export function LibraryToolbar({ projects, types, favoritesAvailable }: LibraryToolbarProps) {
  const { t, locale } = useMessages(messages)
  const type = useLibraryView((state) => state.type)
  const favoritesOnly = useLibraryView((state) => state.favoritesOnly)
  const order = useLibraryView((state) => state.order)
  const layout = useLibraryView((state) => state.layout)
  const currentProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const setProject = useWorkspaceStore((state) => state.setSelectedProjectId)
  const currentProject = projects.find((item) => item.id === currentProjectId)
  const inlineProjects = projects.slice(0, MAX_INLINE_PROJECTS)

  return (
    <section aria-label={t('搜索与筛选')} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t('按项目切换')} className="flex min-w-0 flex-wrap items-center gap-1">
          <ScopeButton
            active={!currentProjectId && !favoritesOnly}
            label={t('全部')}
            onClick={() => {
              setProject(null)
              useLibraryView.setState({ favoritesOnly: false })
            }}
          />
          {favoritesAvailable && (
            <ScopeButton
              active={favoritesOnly}
              label={t('收藏')}
              icon={
                <Star
                  size={13}
                  aria-hidden="true"
                  className={favoritesOnly ? 'fill-current' : ''}
                />
              }
              onClick={() => {
                setProject(null)
                useLibraryView.setState({ favoritesOnly: !favoritesOnly })
              }}
            />
          )}
          {inlineProjects.length > 0 && (
            <span className="mx-1 h-3.5 w-px bg-border" aria-hidden="true" />
          )}
          {inlineProjects.map((project) => (
            <ScopeButton
              key={project.id}
              active={currentProjectId === project.id && !favoritesOnly}
              label={project.name}
              muted={project.dormant}
              onClick={() => {
                useLibraryView.setState({ favoritesOnly: false })
                setProject(currentProjectId === project.id ? null : project.id)
              }}
            />
          ))}
        </nav>

        <div className="ms-auto flex shrink-0 flex-wrap items-center gap-1">
          <FilterMenu
            label={t('筛选项目')}
            summary={currentProject?.name ?? t('全部项目')}
            value={currentProjectId ?? ''}
          >
            <DropdownMenuRadioItem value="" onSelect={() => setProject(null)}>
              {t('全部项目')}
            </DropdownMenuRadioItem>
            {projects.map((item) => (
              <DropdownMenuRadioItem
                key={item.id}
                value={item.id}
                onSelect={() => {
                  useLibraryView.setState({ favoritesOnly: false })
                  setProject(item.id)
                }}
              >
                <bdi>{item.name}</bdi>
              </DropdownMenuRadioItem>
            ))}
          </FilterMenu>

          <FilterMenu
            label={t('排序方式')}
            summary={order === 'recent' ? t('最近更新') : t('按标题')}
            value={order}
            icon={<ArrowUpDown size={13} />}
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

          <Segmented
            aria-label={t('显示方式')}
            size="sm"
            value={layout}
            onValueChange={(next) =>
              useLibraryView.setState({ layout: next === 'list' ? 'list' : 'cards' })
            }
            segments={[
              { value: 'cards', label: t('卡片'), icon: <LayoutGrid size={14} /> },
              { value: 'list', label: t('列表'), icon: <List size={14} /> },
            ]}
          />
        </div>
      </div>

      {types.length > 1 && (
        <fieldset
          aria-label={t('筛选类型')}
          className="m-0 flex flex-wrap items-center gap-1 border-0 p-0"
        >
          <TypeChip
            active={type === 'all'}
            label={t('全部类型')}
            onClick={() => useLibraryView.setState({ type: 'all' })}
          />
          {types.map((item) => (
            <TypeChip
              key={item}
              active={type === item}
              label={artifactTypeLabel(item, locale)}
              onClick={() => useLibraryView.setState({ type: type === item ? 'all' : item })}
            />
          ))}
        </fieldset>
      )}
    </section>
  )
}

function TypeChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      variant={active ? 'outline' : 'ghost'}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 px-2.5 text-xs ${active ? 'text-ink' : 'text-ink-muted hover:text-ink'}`}
    >
      {label}
    </Button>
  )
}
