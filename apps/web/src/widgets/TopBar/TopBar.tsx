import type {
  Artifact,
  ArtifactSharedAccess,
  ArtifactTransferInput,
  VersionSummary,
} from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { ArrowLeft, PanelLeft, Share2 } from 'lucide-react'
import type { Ref } from 'react'
import { useArtifactManagementQuery } from '@/entities/artifact'
import { useWorkspaceStore, type WorkspaceViewMode } from '@/entities/workspace'
import { HubAccountButton } from '@/features/hub'
import { VersionTimeline } from '@/features/version-timeline'
import { AkashaMark } from '@/shared/brand'
import { isCloudHub } from '@/shared/config/runtime'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { ThemeToggle } from '@/shared/theme'
import { messages } from './messages'
import { ArtifactTitleMenu } from './ui/ArtifactTitleMenu'
import { WorkspacePanelButtons } from './ui/WorkspacePanelButtons'

export interface TopBarProps {
  artifact: Artifact
  version: VersionSummary
  versions: readonly VersionSummary[]
  /** 有值时普通制品链接固定到正在查看的历史版本。 */
  fixedVersion?: number
  feedbackCount?: number
  /** 未解决批注数量，用于决定顶栏批注图标右上角提示点是否点亮；缺省时回退到 `feedbackCount`。 */
  unresolvedCount?: number
  hasActiveRound?: boolean
  onBackToLibrary: () => void
  /** 打开基于当前允许读取版本的整份制品导出。 */
  onExport?: () => void
  onHandoff?: () => void
  agentOpen?: boolean
  agentToggleRef?: Ref<HTMLButtonElement>
  onToggleAgent?: () => void
  shareAccess?: ArtifactSharedAccess
  /** 当前会话能否写入此作品；缺省时按可写兼容旧调用方。 */
  canWrite?: boolean
  /** 当前会话能否发表批注或写入用户态偏好（如收藏）；缺省时按允许兼容。 */
  canComment?: boolean
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
  unresolvedCount,
  hasActiveRound = false,
  onBackToLibrary,
  onExport,
  onHandoff,
  agentOpen = false,
  agentToggleRef,
  onToggleAgent,
  shareAccess,
  canWrite = true,
  canComment = true,
  onShare,
  onTransfer,
  onSelectVersion,
}: TopBarProps) {
  const { t } = useMessages(messages)
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[artifact.projectId])

  const management = useArtifactManagementQuery(artifact.publicId, artifact.projectId, !shareAccess)
  const canManage = !shareAccess && management.isSuccess && management.data.canManage

  const editing = !shareAccess && agentActivity?.state === 'editing'
  const readOnlySession = !shareAccess && !canWrite
  let statusLabel: string | undefined
  if (shareAccess) statusLabel = t(getShareRole(shareAccess, fixedVersion))
  else if (readOnlySession) statusLabel = t('只读')
  const readOnlyHint = isCloudHub()
    ? t('当前账户没有编辑权限')
    : t('当前会话未授权写入，请通过 akasha open 打开')

  const showTool = (mode: WorkspaceViewMode) => setViewMode(mode)
  const showCanvas = () => showTool('preview')
  const openQuickJump = () => setCommandPaletteOpen(true)

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 border-b border-border/80 bg-surface/92 px-2.5 py-1 backdrop-blur-md sm:px-3.5">
      <div className="flex min-w-0 flex-1 basis-40 items-center gap-1">
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
        <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block" />
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
          canFavorite={!shareAccess && canComment}
          canEdit={
            canWrite &&
            (!shareAccess || (shareAccess.role === 'edit' && fixedVersion === undefined))
          }
          onQuickJump={openQuickJump}
        />
        <VersionTimeline
          publicId={artifact.publicId}
          activeVersion={version.version}
          headVersion={artifact.headVersion}
          versions={versions}
          canRevert={canWrite && !shareAccess}
          onSelectVersion={onSelectVersion}
        />
        {readOnlySession ? (
          <Badge tone="neutral" title={readOnlyHint} className="ms-1 hidden sm:inline-flex">
            {t('只读')}
          </Badge>
        ) : null}
      </div>

      <div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-1">
        {editing ? (
          <span
            role="status"
            title={agentActivity.summary}
            className="me-1 hidden items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 py-1 text-xs text-ink-muted sm:flex"
          >
            <AkashaMark size={13} loading className="text-ink" />
            {t('Agent 正在修改')}
          </span>
        ) : null}
        {viewMode !== 'preview' ? (
          <Button variant="secondary" size="sm" onClick={showCanvas}>
            {t('返回画布')}
          </Button>
        ) : null}
        {onToggleAgent ? (
          <Button
            ref={agentToggleRef}
            variant={agentOpen ? 'secondary' : 'ghost'}
            size="sm"
            leftIcon={<PanelLeft size={15} className="rtl:-scale-x-100" />}
            aria-label={t('Agent 对话')}
            title={t('Agent 对话')}
            aria-expanded={agentOpen}
            aria-controls={agentOpen ? 'artifact-agent-conversation' : undefined}
            onClick={onToggleAgent}
          >
            <span className="sr-only sm:not-sr-only">{t('会话')}</span>
          </Button>
        ) : null}
        <WorkspacePanelButtons
          feedbackCount={feedbackCount}
          unresolvedCount={unresolvedCount}
          hasActiveRound={hasActiveRound}
        />
        {canManage && onShare && (
          <Button
            size="sm"
            className="ms-0.5"
            leftIcon={<Share2 size={14} />}
            title={t('分享')}
            onClick={onShare}
          >
            <span className="sr-only sm:not-sr-only">{t('分享')}</span>
          </Button>
        )}
        <span aria-hidden="true" className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block" />
        <ThemeToggle />
        <LanguageMenu />
        <HubAccountButton />
      </div>
    </header>
  )
}
