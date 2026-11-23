import type { Artifact, Version } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { ArrowLeft, Code2, Ellipsis, GitCompare, MessageSquare, Pencil, Search } from 'lucide-react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore, type WorkspaceViewMode } from '../../entities/workspace/store'
import { ExportHtmlMenuItem } from '../../features/export-html/ExportHtmlMenuItem'
import { VersionTimeline } from '../../features/version-timeline/VersionTimeline'

export interface TopBarProps {
  artifact: Artifact
  version: Version
  versions: readonly Version[]
  feedbackCount?: number
  hasActiveRound?: boolean
  onBackToLibrary: () => void
  onSelectVersion: (version?: number) => void
}

export function TopBar({
  artifact,
  version,
  versions,
  feedbackCount = 0,
  hasActiveRound = false,
  onBackToLibrary,
  onSelectVersion,
}: TopBarProps) {
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const setViewMode = useWorkspaceStore((s) => s.setViewMode)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorTab !== null)
  const setInspectorTab = useWorkspaceStore((s) => s.setInspectorTab)
  const setCommandPaletteOpen = useWorkspaceStore((s) => s.setCommandPaletteOpen)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[artifact.projectId])

  const editing = agentActivity?.state === 'editing'
  const agentStatus = editing
    ? 'Agent 正在修改'
    : agentActivity?.state === 'idle' || wsStatus === 'open'
      ? 'Agent 空闲待命'
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
        <h1 className="truncate text-sm font-semibold text-ink" title={artifact.title}>
          {artifact.title}
        </h1>
        <VersionTimeline
          publicId={artifact.publicId}
          activeVersion={version.version}
          headVersion={artifact.headVersion}
          versions={versions}
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
        <Button
          variant={inspectorOpen ? 'secondary' : 'ghost'}
          size="sm"
          leftIcon={<MessageSquare size={14} />}
          aria-expanded={inspectorOpen}
          aria-controls="artifact-inspector"
          onClick={() => setInspectorTab(inspectorOpen ? null : 'review')}
        >
          {reviewLabel}
          {feedbackCount > 0 ? ` ${feedbackCount}` : ''}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" iconOnly aria-label="更多操作" title="更多操作">
              <Ellipsis size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => showTool('source')}>
              <Code2 size={14} />
              查看源码
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => showTool('edit')}>
              <Pencil size={14} />
              编辑代码
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => showTool('diff')}>
              <GitCompare size={14} />
              对比版本
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ExportHtmlMenuItem artifact={artifact} version={version} />
            <DropdownMenuItem onSelect={() => setCommandPaletteOpen(true)}>
              <Search size={14} />
              快速跳转
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{agentStatus}</DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
