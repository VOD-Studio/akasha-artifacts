import type { ArtifactType, Project } from '@akasha/protocol'
import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Plus } from 'lucide-react'
import { type UIEventHandler, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useArtifactFavoritesQuery, useArtifactsQuery } from '@/entities/artifact'
import { useProjectsQuery } from '@/entities/project'
import { useWorkspaceStore } from '@/entities/workspace'
import { DaemonStatusPill } from '@/features/daemon-control'
import { HubAccountButton, useHubSession } from '@/features/hub'
import { AkashaMark } from '@/shared/brand'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { CreateDesignDialog } from './CreateDesignDialog'
import { LibraryMenu } from './LibraryMenu'
import { LibraryLoading, LibraryResults } from './LibraryResults'
import { LibraryToolbar } from './LibraryToolbar'
import { useLibraryView } from './library-view'
import { messages } from './messages'
import { useDesignConnections } from './useDesignConnections'
import { WithdrawnArtifactsDialog } from './WithdrawnArtifactsDialog'

const LIBRARY_REFRESH_MS = 10_000

export interface LibraryShellProps {
  onOpenArtifact: (publicId: string) => void
}

/** 制品库组合筛选、结果与项目管理；由制品返回时还原库页视图。 */
export function LibraryShell({ onOpenArtifact }: LibraryShellProps) {
  const { t, locale } = useMessages(messages)
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
  const connections = useDesignConnections(!cloudHub)
  const [canResume, setCanResume] = useState(false)
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [showCreateDesign, setShowCreateDesign] = useState(false)
  const projectsQuery = useProjectsQuery(LIBRARY_REFRESH_MS)
  const artifactsQuery = useArtifactsQuery(undefined, LIBRARY_REFRESH_MS)
  const favoritesQuery = useArtifactFavoritesQuery()
  const favorites = useMemo(
    () => (favoritesQuery.isSuccess ? new Set(favoritesQuery.data) : null),
    [favoritesQuery.isSuccess, favoritesQuery.data],
  )
  const projects = projectsQuery.isSuccess ? projectsQuery.data : undefined
  const artifacts = artifactsQuery.data
  const isLoading = projectsQuery.isLoading || artifactsQuery.isLoading
  const failure = artifactsQuery.error ?? projectsQuery.error

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>()
    for (const project of projects ?? []) map.set(project.id, project)
    return map
  }, [projects])
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase(locale)
    const list = (artifacts ?? []).filter((artifact) => {
      if (favoritesOnly && favorites && !favorites.has(artifact.publicId)) return false
      if (selectedProjectId && artifact.projectId !== selectedProjectId) return false
      if (type !== 'all' && artifact.type !== type) return false
      return (
        !keyword ||
        artifact.title.toLocaleLowerCase(locale).includes(keyword) ||
        artifact.slug.toLocaleLowerCase(locale).includes(keyword) ||
        artifact.publicId.toLocaleLowerCase(locale).includes(keyword) ||
        projectMap.get(artifact.projectId)?.name.toLocaleLowerCase(locale).includes(keyword)
      )
    })
    return list.sort(
      order === 'title'
        ? (a, b) => a.title.localeCompare(b.title, locale)
        : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
  }, [
    artifacts,
    favorites,
    favoritesOnly,
    locale,
    order,
    projectMap,
    search,
    selectedProjectId,
    type,
  ])
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

  const canManage = cloudHub ? hubSession?.member === true : connections.isSuccess
  const canCreate =
    !cloudHub &&
    connections.isSuccess &&
    connections.data.connections.some(
      (entry) => entry.availability === 'ready' && projectMap.has(entry.projectId),
    )
  const resume = !cloudHub && canManage && canResume && !canCreate
  const openDesign = () => setShowCreateDesign(true)
  const closeDesign = () => setShowCreateDesign(false)
  const openWithdrawn = () => setShowWithdrawn(true)
  const closeWithdrawn = () => setShowWithdrawn(false)
  const openPublishedDesign = (id: string) => {
    closeDesign()
    onOpenArtifact(id)
  }
  const rememberScroll: UIEventHandler<HTMLDivElement> = (event) =>
    useLibraryView.setState({ scrollTop: event.currentTarget.scrollTop })
  const resetFilters = () => {
    setSelectedProjectId(null)
    useLibraryView.setState({ search: '', type: 'all', favoritesOnly: false })
  }
  const retryLibrary = () => {
    if (artifactsQuery.isError) void artifactsQuery.refetch()
    if (projectsQuery.isError) void projectsQuery.refetch()
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex flex-wrap min-h-13 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-4 sm:px-6">
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <AkashaMark size={20} />
          <span>Akasha</span>
        </span>
        <div className="ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">
          <LanguageMenu />
          {cloudHub ? <HubAccountButton /> : <DaemonStatusPill />}
          {canManage && <LibraryMenu projects={projects ?? []} onOpenWithdrawn={openWithdrawn} />}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-4 sm:px-6">
        <div className="flex flex-none flex-col gap-4 pb-5 pt-6 sm:pt-10">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{t('作品')}</h1>
            {((canCreate && !!artifacts?.length) || resume) && (
              <Button leftIcon={<Plus size={16} />} onClick={openDesign}>
                {resume ? t('继续设计会话') : t('新建设计')}
              </Button>
            )}
          </div>
          <LibraryToolbar
            projects={projects ?? []}
            types={presentTypes}
            favoritesAvailable={favorites !== null}
          />
        </div>
        <ScrollArea
          ref={scrollRef}
          aria-label={t('作品列表')}
          className="-mx-1 flex-1 px-1 pt-1 pb-6"
          aria-busy={!failure && isLoading}
          onScroll={rememberScroll}
        >
          {failure && (
            <Alert
              tone="danger"
              title={t('无法打开作品库')}
              action={{ label: t('重试'), onClick: retryLibrary }}
            />
          )}
          {!failure && isLoading && <LibraryLoading cards={layout === 'cards'} />}
          {!failure && !isLoading && (
            <LibraryResults
              artifacts={visible}
              projects={projectMap}
              favorites={favorites}
              cards={layout === 'cards'}
              hasArtifacts={Boolean(artifacts?.length)}
              cloudHub={cloudHub}
              onCreate={canCreate ? openDesign : undefined}
              onResetFilters={resetFilters}
              onOpenArtifact={onOpenArtifact}
            />
          )}
        </ScrollArea>
      </main>
      {/* 保留同一个提交实例，关闭再重开不能丢掉还未返回的受理响应。 */}
      {!cloudHub && (
        <CreateDesignDialog
          projects={projects ?? []}
          open={showCreateDesign}
          onResumableChange={setCanResume}
          onClose={closeDesign}
          onOpenArtifact={openPublishedDesign}
        />
      )}
      {canManage && showWithdrawn ? (
        <WithdrawnArtifactsDialog onOpenArtifact={onOpenArtifact} onClose={closeWithdrawn} />
      ) : null}
    </div>
  )
}
