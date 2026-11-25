import type {
  Artifact,
  ArtifactSharedAccess,
  ArtifactTransferInput,
  VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ArrowLeft, PanelLeft, Share2 } from 'lucide-react'
import type { Ref } from 'react'
import { useArtifactManagementQuery } from '@/entities/artifact'
import { useWorkspaceStore, type WorkspaceViewMode } from '@/entities/workspace'
import { HubAccountButton } from '@/features/hub'
import { VersionTimeline } from '@/features/version-timeline'
import { AkashaMark } from '@/shared/brand'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { ArtifactTitleMenu } from './ArtifactTitleMenu'
import { messages } from './messages'
import { WorkspacePanelButtons } from './WorkspacePanelButtons'

export interface TopBarProps {
  artifact: Artifact
  version: VersionSummary
  versions: readonly VersionSummary[]
  /** 有值时普通制品链接固定到正在查看的历史版本。 */
  fixedVersion?: number
  feedbackCount?: number
  hasActiveRound?: boolean
  onBackToLibrary: () => void
  /** 打开基于当前允许读取版本的整份制品导出。 */
  onExport?: () => void
  onHandoff?: () => void
  agentOpen?: boolean
  agentToggleRef?: Ref<HTMLButtonElement>
  onToggleAgent?: () => void
  shareAccess?: ArtifactSharedAccess
  onShare?: () => void
  onTransfer?: (kind: ArtifactTransferInput['kind']) => void
  onSelectVersion: (version?: number) => void
}

function getShareRole(access: ArtifactSharedAccess, fixedVersion?: number) {
  if (access.role === 'view') return '仅查看'
  if (access.role === 'edit' && fixedVersion === undefined) return '可编辑'
  return '可批注'
}

export function TopBar({
  artifact,
  version,
  versions,
  fixedVersion,
  feedbackCount = 0,
  hasActiveRound = false,
  onBackToLibrary,
  onExport,
  onHandoff,
  agentOpen = false,
  agentToggleRef,
  onToggleAgent,
  shareAccess,
  onShare,
  onTransfer,
  onSelectVersion,
}: TopBarProps) {
  const { t } = useMessages(messages)
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[artifact.projectId])

  const management = useArtifactManagementQuery(artifact.publicId)
  const canManage = management.data?.canManage === true

  const editing = !shareAccess && agentActivity?.state === 'editing'
  const statusLabel = shareAccess ? t(getShareRole(shareAccess, fixedVersion)) : undefined

  const showTool = (mode: WorkspaceViewMode) => setViewMode(mode)
  const showCanvas = () => showTool('preview')
  const openQuickJump = () => setCommandPaletteOpen(true)

  return (
    <header className="flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-border bg-surface px-2 py-1 sm:px-4">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={t('返回作品库')}
          title={t('返回作品库')}
          onClick={onBackToLibrary}
        >
          <ArrowLeft size={16} className="rtl:rotate-180" />
        </Button>
        <ArtifactTitleMenu
          artifact={artifact}
          fixedVersion={fixedVersion}
          statusLabel={statusLabel}
          onShowTool={showTool}
          onExport={onExport}
          onHandoff={onHandoff}
          onTransfer={onTransfer}
          onWithdrawn={shareAccess ? undefined : onBackToLibrary}
          shared={Boolean(shareAccess)}
          canManage={canManage}
          canEdit={!shareAccess || (shareAccess.role === 'edit' && fixedVersion === undefined)}
          onQuickJump={openQuickJump}
        />
        <VersionTimeline
          publicId={artifact.publicId}
          activeVersion={version.version}
          headVersion={artifact.headVersion}
          versions={versions}
          canRevert={!shareAccess}
          onSelectVersion={onSelectVersion}
        />
      </div>

      <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-1 sm:gap-2">
        {editing ? (
          <span
            role="status"
            title={agentActivity.summary}
            className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex"
          >
            <AkashaMark size={14} loading className="text-ink" />
            {t('Agent 正在修改')}
          </span>
        ) : null}
        {viewMode !== 'preview' ? (
          <Button variant="ghost" size="sm" onClick={showCanvas}>
            {t('返回画布')}
          </Button>
        ) : null}
        {onToggleAgent ? (
          <Button
            ref={agentToggleRef}
            variant={agentOpen ? 'secondary' : 'ghost'}
            size="sm"
            leftIcon={<PanelLeft size={16} className="rtl:-scale-x-100" />}
            aria-label={t('Agent 对话')}
            title={t('Agent 对话')}
            aria-expanded={agentOpen}
            aria-controls={agentOpen ? 'artifact-agent-conversation' : undefined}
            onClick={onToggleAgent}
          >
            <span className="sr-only sm:not-sr-only">{t('会话')}</span>
          </Button>
        ) : null}
        <WorkspacePanelButtons feedbackCount={feedbackCount} hasActiveRound={hasActiveRound} />
        {canManage && onShare && (
          <Button size="sm" leftIcon={<Share2 size={14} />} title={t('分享')} onClick={onShare}>
            <span className="sr-only sm:not-sr-only">{t('分享')}</span>
          </Button>
        )}
        <LanguageMenu />
        <HubAccountButton />
      </div>
    </header>
  )
}
