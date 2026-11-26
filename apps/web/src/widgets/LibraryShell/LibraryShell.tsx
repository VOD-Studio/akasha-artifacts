import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { SearchInput } from '@akasha/ui/input'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Plus } from 'lucide-react'
import { type UIEventHandler, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { CreateDesignDialog, useDesignAvailability } from '@/features/agent-conversation'
import { WithdrawnArtifactsDialog } from '@/features/artifact-management'
import { DaemonStatusPill } from '@/features/daemon-control'
import { ImportSystemLauncher } from '@/features/design-system'
import { HubAccountButton, useHubSession } from '@/features/hub'
import { HubSharingPolicyLauncher } from '@/features/hub-sharing-policy'
import { AkashaMark } from '@/shared/brand'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { ThemeToggle } from '@/shared/theme'
import { useLibraryResults } from './hooks/useLibraryResults'
import { messages } from './messages'
import { useLibraryView } from './model/library-view'
import { LibraryMenu } from './ui/LibraryMenu'
import { LibraryLoading, LibraryResults } from './ui/LibraryResults'
import { LibraryToolbar } from './ui/LibraryToolbar'

export interface LibraryShellProps {
  /** 缺省为个人预览；显式选择 Hub 时不跳至本机副本。 */
  onOpenArtifact: (publicId: string, destination?: 'hub') => void
}

const SCROLL_GLASS_THRESHOLD = 4

/** 制品库组合筛选、结果与项目管理；由制品返回时还原库页视图。 */
export function LibraryShell({ onOpenArtifact }: LibraryShellProps) {
  const { t, locale, number } = useMessages(messages)
  const {
    projects,
    projectMap,
    allArtifacts,
    hasArtifacts,
    visible,
    presentTypes,
    favorites,
    isLoading,
    failure,
    resetFilters,
    retryLibrary,
  } = useLibraryResults(locale)
  const search = useLibraryView((state) => state.search)
  const layout = useLibraryView((state) => state.layout)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restored = useRef(false)
  const [scrolled, setScrolled] = useState(false)
  const cloudHub = isCloudHub()
  const hubSession = useHubSession()
  const { authorized, canCreate } = useDesignAvailability(!cloudHub, projectMap)
  const [canResume, setCanResume] = useState(false)
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [showCreateDesign, setShowCreateDesign] = useState(false)

  useLayoutEffect(() => {
    if (isLoading || !scrollRef.current || restored.current) return
    const savedTop = useLibraryView.getState().scrollTop
    scrollRef.current.scrollTop = savedTop
    setScrolled(savedTop > SCROLL_GLASS_THRESHOLD)
    restored.current = true
  }, [isLoading])

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

  const canManage = cloudHub ? hubSession?.member === true : authorized
  const resume = !cloudHub && canManage && canResume && !canCreate
  const openDesign = () => setShowCreateDesign(true)
  const closeDesign = () => setShowCreateDesign(false)
  const openWithdrawn = () => setShowWithdrawn(true)
  const closeWithdrawn = () => setShowWithdrawn(false)
  const openPublishedDesign = (id: string) => {
    closeDesign()
    onOpenArtifact(id)
  }
  const resetToHome = () => {
    resetFilters()
    useWorkspaceStore.getState().setSelectedProjectId(null)
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const top = event.currentTarget.scrollTop
    useLibraryView.setState({ scrollTop: top })
    const nextScrolled = top > SCROLL_GLASS_THRESHOLD
    setScrolled((prev) => (prev === nextScrolled ? prev : nextScrolled))
  }

  const projectCount = projects?.length ?? 0
  const showSummary = !failure && !isLoading && hasArtifacts

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <ScrollArea
        ref={scrollRef}
        aria-label={t('作品列表')}
        className="library-scroll min-h-0 flex-1"
        aria-busy={!failure && isLoading}
        onScroll={handleScroll}
      >
        <header className="library-header" data-scrolled={scrolled}>
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6 md:h-14 md:flex-nowrap md:py-0">
            <button
              type="button"
              onClick={resetToHome}
              className="inline-flex shrink-0 items-center gap-2 rounded-8 py-1 font-semibold tracking-tight text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <AkashaMark size={19} />
              <span>Akasha</span>
            </button>

            <div className="order-last w-full md:order-none md:min-w-0 md:max-w-md md:flex-1">
              <SearchInput
                ref={searchRef}
                aria-label={t('搜索作品')}
                placeholder={t('搜索作品')}
                clearLabel={t('清除搜索')}
                controlSize="sm"
                variant={scrolled ? 'outline' : 'filled'}
                shortcut={['mod', 'K']}
                value={search}
                onValueChange={(value) => useLibraryView.setState({ search: value })}
              />
            </div>

            <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
              {cloudHub && hubSession?.admin && <HubSharingPolicyLauncher />}
              {cloudHub ? <HubAccountButton /> : <DaemonStatusPill />}
              <ThemeToggle />
              <LanguageMenu />
              <ImportSystemLauncher
                projects={canManage ? (projects ?? []) : []}
                onOpenArtifact={onOpenArtifact}
              />
              {canManage && (
                <LibraryMenu projects={projects ?? []} onOpenWithdrawn={openWithdrawn} />
              )}
              {((canCreate && hasArtifacts) || resume) && (
                <Button
                  variant="primary"
                  size="sm"
                  className="ms-1"
                  leftIcon={<Plus size={15} />}
                  onClick={openDesign}
                >
                  {resume ? t('继续设计会话') : t('新建设计')}
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-col px-4 pt-6 pb-14 sm:px-6 sm:pt-8">
          <div className="flex flex-col gap-4 border-b border-border pb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{t('作品库')}</h1>
              {showSummary && (
                <p className="text-xs text-ink-muted tabular-nums">
                  <span>{t('共 {count} 件作品', { count: number(allArtifacts.length) })}</span>
                  {projectCount > 0 && (
                    <>
                      <span className="mx-1.5 opacity-40">·</span>
                      <span>{t('{count} 个项目', { count: number(projectCount) })}</span>
                    </>
                  )}
                  {favorites !== null && favorites.size > 0 && (
                    <>
                      <span className="mx-1.5 opacity-40">·</span>
                      <span>{t('{count} 项收藏', { count: number(favorites.size) })}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            <LibraryToolbar
              projects={projects ?? []}
              types={presentTypes}
              favoritesAvailable={favorites !== null}
            />
          </div>

          <div className="pt-6">
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
                hasArtifacts={hasArtifacts}
                cloudHub={cloudHub}
                onCreate={canCreate ? openDesign : undefined}
                onResetFilters={resetFilters}
                onOpenArtifact={onOpenArtifact}
              />
            )}
          </div>
        </main>
      </ScrollArea>

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
