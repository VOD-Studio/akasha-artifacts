import type { Artifact, Version } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Kbd } from '@akasha/ui/kbd'
import { Segmented } from '@akasha/ui/segmented'
import { ArrowLeft, Code2, Eye, GitCompare, Search } from 'lucide-react'
import { useWorkspaceStore, type WorkspaceViewMode } from '../../entities/workspace/store'
import { DaemonStatusPill } from '../../features/daemon-control/DaemonStatusPill'
import { ExportHtmlButton } from '../../features/export-html/ExportHtmlButton'
import { VersionTimeline } from '../../features/version-timeline/VersionTimeline'
import { ARTIFACT_TYPE_LABELS } from '../../shared/lib/format'

export interface TopBarProps {
  artifact: Artifact
  version: Version
  versions: readonly Version[]
  onBackToLibrary: () => void
  onSelectVersion: (version?: number) => void
}

export function TopBar({
  artifact,
  version,
  versions,
  onBackToLibrary,
  onSelectVersion,
}: TopBarProps) {
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[artifact.projectId])

  const activityBadge = (() => {
    if (agentActivity?.state === 'editing') {
      return {
        tone: 'accent' as const,
        label: agentActivity.summary
          ? `Agent 正在修改 · ${agentActivity.summary}`
          : 'Agent 正在修改',
      }
    }
    if (agentActivity?.state === 'idle' || wsStatus === 'open') {
      return { tone: 'ok' as const, label: '空闲待命' }
    }
    return { tone: 'off' as const, label: '离线快照' }
  })()

  return (
    <header className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="返回项目库"
          onClick={onBackToLibrary}
        >
          <ArrowLeft size={15} />
        </Button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ink">{artifact.title}</h1>
            <Badge tone="neutral">{ARTIFACT_TYPE_LABELS[artifact.type] ?? artifact.type}</Badge>
          </div>
        </div>

        <VersionTimeline
          publicId={artifact.publicId}
          activeVersion={version.version}
          headVersion={artifact.headVersion}
          versions={versions}
          onSelectVersion={onSelectVersion}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Segmented<WorkspaceViewMode>
          aria-label="工作区视图模式"
          value={viewMode}
          onValueChange={setViewMode}
          size="sm"
          segments={[
            { value: 'preview', label: '预览', icon: <Eye size={13} /> },
            { value: 'diff', label: 'Diff', icon: <GitCompare size={13} /> },
            { value: 'source', label: '源码', icon: <Code2 size={13} /> },
          ]}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge tone={activityBadge.tone} data-testid="agent-activity-badge">
          {activityBadge.label}
        </Badge>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<Search size={13} />}
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="打开全局命令面板"
        >
          <Kbd size="sm" keys={['mod', 'K']} />
        </Button>

        <ExportHtmlButton artifact={artifact} version={version} />
        <DaemonStatusPill />
      </div>
    </header>
  )
}
