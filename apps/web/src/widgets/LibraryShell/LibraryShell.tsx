import type { Artifact, ArtifactType, Project } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { Empty } from '@akasha/ui/empty'
import { Kbd } from '@akasha/ui/kbd'
import { ScrollArea } from '@akasha/ui/scroll-area'
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderGit2,
  Layers,
  MoreHorizontal,
  Search,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useArtifactsQuery } from '../../entities/artifact/queries'
import { useProjectsQuery, useRemoveProjectMutation } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { DaemonStatusPill } from '../../features/daemon-control/DaemonStatusPill'
import { HubAccountButton } from '../../features/hub/HubActions'
import { isCloudHub } from '../../shared/config/runtime'
import { ARTIFACT_TYPE_LABELS, formatRelativeTime } from '../../shared/lib/format'

const HUB_LIBRARY_REFRESH_MS = 10_000

export interface LibraryShellProps {
  onOpenArtifact: (publicId: string) => void
}

export function LibraryShell({ onOpenArtifact }: LibraryShellProps) {
  const selectedProjectId = useWorkspaceStore((s) => s.selectedProjectId)
  const setSelectedProjectId = useWorkspaceStore((s) => s.setSelectedProjectId)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const [searchText, setSearchText] = useState('')
  const [selectedType, setSelectedType] = useState<ArtifactType | 'all'>('all')
  const [showDormant, setShowDormant] = useState(false)
  const [contextProject, setContextProject] = useState<string | null>(null)

  const cloudHub = isCloudHub()
  const interval = cloudHub ? HUB_LIBRARY_REFRESH_MS : undefined
  const { data: projects = [], isLoading: projectsLoading } = useProjectsQuery(interval)
  const { data: allArtifacts = [], isLoading: artifactsLoading } = useArtifactsQuery(
    undefined,
    interval,
  )
  const removeProjectMutation = useRemoveProjectMutation()

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt)),
    [projects],
  )
  const activeProjects = useMemo(() => sortedProjects.filter((p) => !p.dormant), [sortedProjects])
  const dormantProjects = useMemo(() => sortedProjects.filter((p) => p.dormant), [sortedProjects])

  const countByProject = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of allArtifacts) {
      counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1)
    }
    return counts
  }, [allArtifacts])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const filteredArtifacts = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return [...allArtifacts]
      .filter((a) => !selectedProjectId || a.projectId === selectedProjectId)
      .filter((a) => selectedType === 'all' || a.type === selectedType)
      .filter((a) => {
        if (!q) return true
        const projName = projectMap.get(a.projectId)?.name ?? ''
        return (
          a.title.toLowerCase().includes(q) ||
          a.slug.toLowerCase().includes(q) ||
          a.publicId.toLowerCase().includes(q) ||
          projName.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }, [allArtifacts, selectedProjectId, selectedType, searchText, projectMap])

  const presentTypes = useMemo(() => {
    const set = new Set<ArtifactType>()
    for (const a of allArtifacts) set.add(a.type)
    return Array.from(set)
  }, [allArtifacts])

  const handleRemoveProject = async (project: Project) => {
    try {
      await removeProjectMutation.mutateAsync(project.id)
      if (selectedProjectId === project.id) {
        setSelectedProjectId(null)
      }
      toast.success(`已移除项目登记「${project.name}」`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除项目登记失败')
    }
  }

  const renderProjectRow = (project: Project) => {
    const isSelected = selectedProjectId === project.id
    const count = countByProject.get(project.id) ?? 0
    return (
      <div
        key={project.id}
        className={`group flex items-center justify-between gap-1 rounded-lg px-2.5 py-1.5 text-xs transition ${
          isSelected
            ? 'bg-accent/12 font-medium text-ink'
            : 'text-ink-muted hover:bg-muted/70 hover:text-ink'
        }`}
      >
        <button
          type="button"
          onClick={() => setSelectedProjectId(project.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextProject(project.id)
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={project.rootPath}
        >
          <FolderGit2 size={14} className="shrink-0 opacity-75" />
          <span className="truncate">{project.name}</span>
        </button>

        <span className="shrink-0 font-mono text-[11px] opacity-60">{count}</span>

        <DropdownMenu
          open={contextProject === project.id ? true : undefined}
          onOpenChange={(open) => {
            if (!open && contextProject === project.id) setContextProject(null)
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`项目 ${project.name} 操作`}
              className="rounded p-0.5 opacity-0 transition hover:bg-muted group-hover:opacity-100 focus:opacity-100"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => void handleRemoveProject(project)}
              className="text-red-600"
            >
              <Trash2 size={13} className="mr-1.5" />
              移除项目登记
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <div>
          <div className="text-sm font-semibold leading-none text-ink">Akasha Terminal</div>
          <div className="mt-0.5 text-[11px] text-ink-muted">多项目交互式 Artifact 工作台</div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Search size={13} />}
            onClick={() => setCommandPaletteOpen(true)}
          >
            快速跳转
            <Kbd size="sm" keys={['mod', 'K']} className="ml-1.5" />
          </Button>
          {cloudHub ? <HubAccountButton /> : <DaemonStatusPill />}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="项目导航"
          className="flex w-64 shrink-0 flex-col border-r border-border bg-surface-subtle"
        >
          <ScrollArea aria-label="项目列表" className="flex-1 p-3">
            <button
              type="button"
              onClick={() => setSelectedProjectId(null)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-xs transition ${
                selectedProjectId === null
                  ? 'bg-accent/12 font-semibold text-ink'
                  : 'text-ink-muted hover:bg-muted/70 hover:text-ink'
              }`}
            >
              <span className="flex items-center gap-2">
                <Layers size={14} />
                最近 · 所有项目
              </span>
              <span className="font-mono text-[11px] opacity-70">{allArtifacts.length}</span>
            </button>

            <div className="mt-4">
              <div className="mb-1.5 px-2.5 text-[11px] font-medium text-ink-muted">
                活跃项目（{activeProjects.length}）
              </div>
              {projectsLoading ? (
                <div className="px-2.5 py-2 text-xs text-ink-muted">加载项目中…</div>
              ) : activeProjects.length === 0 ? (
                <div className="px-2.5 py-2 text-xs text-ink-muted">暂无活跃登记项目</div>
              ) : (
                <div className="space-y-0.5">{activeProjects.map(renderProjectRow)}</div>
              )}
            </div>

            {dormantProjects.length > 0 ? (
              <div className="mt-4 border-t border-border/70 pt-3">
                <button
                  type="button"
                  onClick={() => setShowDormant((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:text-ink"
                >
                  {showDormant ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  休眠项目（{dormantProjects.length}）
                </button>
                {showDormant ? (
                  <div className="mt-1 space-y-0.5 opacity-80">
                    {dormantProjects.map(renderProjectRow)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
            <div className="relative min-w-[220px] flex-1 max-w-md">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="筛选标题、slug 或项目…"
                className="w-full rounded-lg border border-border bg-surface py-1.5 pr-3 pl-8 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedType('all')}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  selectedType === 'all'
                    ? 'bg-ink text-surface font-medium'
                    : 'bg-muted/60 text-ink-muted hover:text-ink'
                }`}
              >
                全部
              </button>
              {presentTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setSelectedType(type)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    selectedType === type
                      ? 'bg-ink text-surface font-medium'
                      : 'bg-muted/60 text-ink-muted hover:text-ink'
                  }`}
                >
                  {ARTIFACT_TYPE_LABELS[type] ?? type}
                </button>
              ))}
            </div>
          </div>

          <ScrollArea aria-label="Artifact 列表" className="flex-1 p-6">
            {artifactsLoading ? (
              <div className="py-12 text-center text-sm text-ink-muted">
                正在加载 Artifact 列表…
              </div>
            ) : filteredArtifacts.length === 0 ? (
              <Empty
                title={allArtifacts.length === 0 ? '还没有发布过 Artifact' : '没有匹配的 Artifact'}
                description={
                  allArtifacts.length === 0
                    ? '在终端 Agent 中调用 artifact_publish，页面会实时出现在这里。'
                    : '试试清空筛选关键词或切换到「最近 · 所有项目」。'
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredArtifacts.map((art: Artifact) => {
                  const project = projectMap.get(art.projectId)
                  return (
                    <button
                      key={art.publicId}
                      type="button"
                      onClick={() => onOpenArtifact(art.publicId)}
                      className="group flex flex-col rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent/60 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="line-clamp-1 text-sm font-semibold text-ink group-hover:text-accent">
                          {art.title}
                        </h2>
                        <Badge tone="neutral">{ARTIFACT_TYPE_LABELS[art.type] ?? art.type}</Badge>
                      </div>

                      <div className="mt-1.5 truncate font-mono text-[11px] text-ink-muted">
                        {art.slug}
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-[11px] text-ink-muted">
                        <span className="truncate">{project?.name ?? art.projectId}</span>
                        <span className="inline-flex shrink-0 items-center gap-2">
                          <span className="font-mono font-medium text-ink">v{art.headVersion}</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            {formatRelativeTime(art.updatedAt)}
                          </span>
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </main>
      </div>
    </div>
  )
}
