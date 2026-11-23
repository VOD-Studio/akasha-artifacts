import type {
  Artifact,
  ArtifactSharedAccess,
  ArtifactTransferInput,
  Version,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ArrowLeft, Bot, MessageSquare, ScanLine } from 'lucide-react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore, type WorkspaceViewMode } from '../../entities/workspace/store'
import { HubAccountButton } from '../../features/hub/HubActions'
import { VersionTimeline } from '../../features/version-timeline/VersionTimeline'
import { ArtifactTitleMenu } from './ArtifactTitleMenu'

export interface TopBarProps {
  artifact: Artifact
  version: Version
  versions: readonly Version[]
  /** 有值时普通制品链接固定到正在查看的历史版本。 */
  fixedVersion?: number
  feedbackCount?: number
  hasActiveRound?: boolean
  onBackToLibrary: () => void
  /** 打开基于当前允许读取版本的整份制品导出。 */
  onExport?: () => void
  onHandoff?: () => void
  agentOpen?: boolean
  onToggleAgent?: () => void
  shareAccess?: ArtifactSharedAccess
  onShare?: () => void
  onTransfer?: (kind: ArtifactTransferInput['kind']) => void
  onSelectVersion: (version?: number) => void
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
  onToggleAgent,
  shareAccess,
  onShare,
  onTransfer,
  onSelectVersion,
}: TopBarProps) {
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorTab === 'inspect')
  const reviewOpen = useWorkspaceStore((s) => s.inspectorTab === 'review')
  const setInspectorTab = useWorkspaceStore((s) => s.setInspectorTab)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[artifact.projectId])

  const editing = !shareAccess && agentActivity?.state === 'editing'
  const agentStatus = shareAccess
    ? `分享权限：${shareAccess.role === 'view' ? '仅查看' : shareAccess.role === 'edit' && shareAccess.version === undefined ? '可编辑' : '可批注'}`
    : editing
      ? 'Agent 正在修改'
      : agentActivity?.state === 'idle'
        ? 'Agent 空闲'
        : wsStatus === 'open'
          ? '工作区已连接'
          : '离线快照'
  const reviewLabel = hasActiveRound ? '评审' : '批注'

  const showTool = (mode: WorkspaceViewMode) => {
    useSelectionStore.getState().setPickerActive(false)
    setViewMode(mode)
  }

  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="返回项目库"
          title="返回项目库"
          onClick={onBackToLibrary}
        >
          <ArrowLeft size={16} />
        </Button>
        <ArtifactTitleMenu
          artifact={artifact}
          fixedVersion={fixedVersion}
          agentStatus={agentStatus}
          onShowTool={showTool}
          onExport={onExport}
          onHandoff={onHandoff}
          onShare={onShare}
          onTransfer={onTransfer}
          onWithdrawn={shareAccess ? undefined : onBackToLibrary}
          shared={Boolean(shareAccess)}
          canEdit={!shareAccess || (shareAccess.role === 'edit' && fixedVersion === undefined)}
          onQuickJump={() => setCommandPaletteOpen(true)}
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

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {editing ? (
          <span
            role="status"
            title={agentActivity.summary}
            className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {agentStatus}
          </span>
        ) : null}
        {viewMode !== 'preview' ? (
          <Button variant="ghost" size="sm" onClick={() => showTool('preview')}>
            返回画布
          </Button>
        ) : null}
        {onToggleAgent ? (
          <Button
            variant={agentOpen ? 'secondary' : 'ghost'}
            size="sm"
            leftIcon={<Bot size={16} />}
            aria-label="Agent 对话"
            aria-expanded={agentOpen}
            aria-controls={agentOpen ? 'artifact-agent-conversation' : undefined}
            onClick={onToggleAgent}
          >
            <span className="hidden sm:inline">Agent 对话</span>
          </Button>
        ) : null}
        <Button
          variant={inspectorOpen ? 'secondary' : 'ghost'}
          size="sm"
          iconOnly
          aria-label="检查器"
          title="检查器"
          aria-expanded={inspectorOpen}
          aria-haspopup="dialog"
          aria-controls="design-inspector"
          onClick={() => setInspectorTab(inspectorOpen ? null : 'inspect')}
        >
          <ScanLine size={15} />
        </Button>
        <Button
          variant={reviewOpen ? 'secondary' : 'ghost'}
          size="sm"
          leftIcon={<MessageSquare size={14} />}
          aria-expanded={reviewOpen}
          aria-haspopup="dialog"
          aria-controls="artifact-inspector"
          onClick={() => {
            useSelectionStore.getState().setFocusedFeedbackId(null)
            setInspectorTab(reviewOpen ? null : 'review')
          }}
        >
          {reviewLabel}
          {feedbackCount > 0 ? ` ${feedbackCount}` : ''}
        </Button>
        <HubAccountButton />
      </div>
    </header>
  )
}
