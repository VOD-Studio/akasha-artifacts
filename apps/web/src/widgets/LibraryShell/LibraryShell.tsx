import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Plus } from 'lucide-react'
import { type UIEventHandler, useLayoutEffect, useRef, useState } from 'react'
import { CreateDesignDialog, useDesignAvailability } from '@/features/agent-conversation'
import { WithdrawnArtifactsDialog } from '@/features/artifact-management'
import { DaemonStatusPill } from '@/features/daemon-control'
import { HubAccountButton, useHubSession } from '@/features/hub'
import { AkashaMark } from '@/shared/brand'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { useLibraryResults } from './hooks/useLibraryResults'
import { messages } from './messages'
import { useLibraryView } from './model/library-view'
import { LibraryMenu } from './ui/LibraryMenu'
import { LibraryLoading, LibraryResults } from './ui/LibraryResults'
import { LibraryToolbar } from './ui/LibraryToolbar'

export interface LibraryShellProps {
  onOpenArtifact: (publicId: string) => void
}

/** 制品库组合筛选、结果与项目管理；由制品返回时还原库页视图。 */
export function LibraryShell({ onOpenArtifact }: LibraryShellProps) {
  const { t, locale } = useMessages(messages)
  const {
    projects,
    projectMap,
    hasArtifacts,
    visible,
    presentTypes,
    favorites,
    isLoading,
    failure,
    resetFilters,
    retryLibrary,
  } = useLibraryResults(locale)
  const layout = useLibraryView((state) => state.layout)
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const cloudHub = isCloudHub()
  const hubSession = useHubSession()
  const { authorized, canCreate } = useDesignAvailability(!cloudHub, projectMap)
  const [canResume, setCanResume] = useState(false)
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [showCreateDesign, setShowCreateDesign] = useState(false)
  useLayoutEffect(() => {
    if (isLoading || !scrollRef.current || restored.current) return
    scrollRef.current.scrollTop = useLibraryView.getState().scrollTop
    restored.current = true
  }, [isLoading])

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
  const rememberScroll: UIEventHandler<HTMLDivElement> = (event) =>
    useLibraryView.setState({ scrollTop: event.currentTarget.scrollTop })

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
            {((canCreate && hasArtifacts) || resume) && (
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
              hasArtifacts={hasArtifacts}
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
