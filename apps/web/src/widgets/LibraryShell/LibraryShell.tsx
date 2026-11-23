import type { ArtifactType, Project } from '@akasha/protocol'
import { Alert } from '@akasha/ui/alert'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { Empty } from '@akasha/ui/empty'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Archive, ChevronDown, FolderGit2, Star, Trash2 } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useArtifactFavoritesQuery, useArtifactsQuery } from '../../entities/artifact/queries'
import { useProjectsQuery, useRemoveProjectMutation } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { DaemonStatusPill } from '../../features/daemon-control/DaemonStatusPill'
import { HubAccountButton, useHubSession } from '../../features/hub/HubActions'
import { isCloudHub } from '../../shared/config/runtime'
import { ARTIFACT_TYPE_LABELS, formatRelativeTime } from '../../shared/lib/format'
import { LibraryArtwork } from './LibraryArtwork'
import { LibraryToolbar } from './LibraryToolbar'
import { useLibraryView } from './library-view'
import { WithdrawnArtifactsDialog } from './WithdrawnArtifactsDialog'

const LIBRARY_REFRESH_MS = 10_000

export interface LibraryShellProps {
  onOpenArtifact: (publicId: string) => void
}

/** 制品库组合筛选、结果与项目管理；由制品返回时还原库页视图。 */
export function LibraryShell({ onOpenArtifact }: LibraryShellProps) {
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const setSelectedProjectId = useWorkspaceStore((state) => state.setSelectedProjectId)
  const search = useLibraryView((state) => state.search)
  const type = useLibraryView((state) => state.type)
  const favoritesOnly = useLibraryView((state) => state.favoritesOnly)
  const order = useLibraryView((state) => state.order)
  const layout = useLibraryView((state) => state.layout)
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const cloudHub = isCloudHub()
  const hubSession = useHubSession()
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const projectsQuery = useProjectsQuery(LIBRARY_REFRESH_MS)
  const artifactsQuery = useArtifactsQuery(undefined, LIBRARY_REFRESH_MS)
  const favoritesQuery = useArtifactFavoritesQuery()
  const favorites = useMemo(
    () => (favoritesQuery.data ? new Set(favoritesQuery.data) : null),
    [favoritesQuery.data],
  )
  const projects = projectsQuery.data
  const artifacts = artifactsQuery.data
  const isLoading = projectsQuery.isLoading || artifactsQuery.isLoading
  const failure = artifactsQuery.error ?? projectsQuery.error

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>()
    for (const project of projects ?? []) map.set(project.id, project)
    return map
  }, [projects])
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase()
    const list = (artifacts ?? []).filter((artifact) => {
      if (favoritesOnly && favorites && !favorites.has(artifact.publicId)) return false
      if (selectedProjectId && artifact.projectId !== selectedProjectId) return false
      if (type !== 'all' && artifact.type !== type) return false
      return (
        !keyword ||
        artifact.title.toLocaleLowerCase().includes(keyword) ||
        artifact.slug.toLocaleLowerCase().includes(keyword) ||
        artifact.publicId.toLocaleLowerCase().includes(keyword) ||
        projectMap.get(artifact.projectId)?.name.toLocaleLowerCase().includes(keyword)
      )
    })
    return list.sort(
      order === 'title'
        ? (a, b) => a.title.localeCompare(b.title)
        : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
  }, [artifacts, favorites, favoritesOnly, order, projectMap, search, selectedProjectId, type])
  const presentTypes = useMemo(() => {
    const values = new Set<ArtifactType>()
    for (const artifact of artifacts ?? []) values.add(artifact.type)
    return Array.from(values)
  }, [artifacts])

  useLayoutEffect(() => {
    if (isLoading || !scrollRef.current || restored.current) return
    scrollRef.current.scrollTop = useLibraryView.getState().scrollTop
    restored.current = true
  }, [isLoading])

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6">
          <h1 className="text-lg font-semibold">制品</h1>
          <div className="flex flex-wrap items-center gap-2">
            {projects?.length ? <ProjectDirectoryMenu projects={projects} /> : null}
            {!cloudHub || hubSession?.member ? (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Archive size={14} />}
                onClick={() => setShowWithdrawn(true)}
              >
                已撤下
              </Button>
            ) : null}
            {cloudHub ? <HubAccountButton /> : <DaemonStatusPill />}
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-3 pb-3 sm:px-6">
          <LibraryToolbar
            projects={projects ?? []}
            types={presentTypes}
            favoritesAvailable={favorites !== null}
          />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <ScrollArea
          ref={scrollRef}
          aria-label="制品列表"
          className="flex-1"
          onScroll={(event) =>
            useLibraryView.setState({ scrollTop: event.currentTarget.scrollTop })
          }
        >
          <div className="mx-auto max-w-6xl px-3 py-5 sm:px-6 sm:py-8">
            {failure ? (
              <Alert tone="danger" title="无法读取制品库" description={failure.message} />
            ) : isLoading ? (
              <p role="status" className="py-8 text-sm text-ink-muted">
                正在加载制品…
              </p>
            ) : !artifacts?.length ? (
              <div className="flex flex-col items-center gap-3">
                <Empty
                  title={cloudHub ? '没有可查看的制品' : '还没有制品'}
                  description={
                    cloudHub
                      ? '请从右上角登录或切换账号，或向项目成员申请访问。'
                      : '在项目里接入 Agent 的 MCP，再用 artifact_publish 发布首个制品。'
                  }
                />
                {cloudHub ? null : (
                  <a
                    className="text-sm text-accent underline"
                    href="https://github.com/VOD-Studio/akasha-artifacts/blob/main/README.zh-CN.md#1-接入你的编程-agentmcp-与-hooks--m1m2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看 Agent 接入步骤
                  </a>
                )}
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3">
                <Empty title="没有匹配的制品" description="换个关键词，或清除筛选查看全部制品。" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSelectedProjectId(null)
                    useLibraryView.setState({ search: '', type: 'all', favoritesOnly: false })
                  }}
                >
                  清除筛选
                </Button>
              </div>
            ) : (
              <ul
                className={
                  layout === 'cards'
                    ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'
                    : 'divide-y divide-border'
                }
              >
                {visible.map((artifact) => (
                  <li key={artifact.publicId}>
                    <button
                      type="button"
                      className={
                        layout === 'cards'
                          ? 'flex h-full w-full flex-col gap-2 rounded-xl border border-border bg-surface p-3 text-left hover:border-accent focus-visible:outline-2 focus-visible:outline-accent'
                          : 'flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded px-2 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent'
                      }
                      onClick={() => onOpenArtifact(artifact.publicId)}
                    >
                      {layout === 'cards' ? (
                        <LibraryArtwork artifact={artifact} />
                      ) : (
                        <h2 className="min-w-0 break-words text-sm font-semibold">
                          {artifact.title}
                        </h2>
                      )}
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                        {favorites?.has(artifact.publicId) ? (
                          <Star size={12} aria-label="已收藏" />
                        ) : null}
                        {layout === 'list' ? (
                          <Badge tone="neutral">{ARTIFACT_TYPE_LABELS[artifact.type]}</Badge>
                        ) : null}
                        <span>{projectMap.get(artifact.projectId)?.name ?? '其他项目'}</span>
                        <time dateTime={artifact.updatedAt}>
                          {formatRelativeTime(artifact.updatedAt)}
                        </time>
                      </span>
                      {layout === 'list' ? (
                        <span className="min-w-0 break-words text-xs text-ink-muted">
                          {artifact.slug} · v{artifact.headVersion}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </main>
      {showWithdrawn ? (
        <WithdrawnArtifactsDialog
          onOpenArtifact={onOpenArtifact}
          onClose={() => setShowWithdrawn(false)}
        />
      ) : null}
    </div>
  )
}

function ProjectDirectoryMenu({ projects }: { projects: readonly Project[] }) {
  const removeProjectMutation = useRemoveProjectMutation()

  async function removeProject(project: Project) {
    try {
      await removeProjectMutation.mutateAsync(project.id)
      const store = useWorkspaceStore.getState()
      if (store.selectedProjectId === project.id) store.setSelectedProjectId(null)
      toast.success(`已移除项目登记「${project.name}」`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '移除项目登记失败')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<FolderGit2 size={14} />}
          rightIcon={<ChevronDown size={12} />}
        >
          管理项目
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {projects.map((project) => (
          <DropdownMenuSub key={project.id}>
            <DropdownMenuSubTrigger>
              {project.name}
              {project.dormant ? '（休眠）' : ''}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                disabled={removeProjectMutation.isPending}
                onSelect={() => void removeProject(project)}
              >
                <Trash2 size={14} />
                移除项目登记
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
