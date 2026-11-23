import type { Version } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@akasha/ui/dropdown-menu'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useRevertArtifactMutation } from '../../entities/artifact/queries'
import { formatRelativeTime } from '../../shared/lib/format'

export interface VersionTimelineProps {
  publicId: string
  activeVersion: number
  headVersion: number
  versions: readonly Version[]
  canRevert?: boolean
  onSelectVersion: (version?: number) => void
}

/**
 * 版本时间线：按版本号倒序展示版本，支持切换查看。
 *
 * @remarks 查看历史版本时，可以把它回退为新的头版本。
 */
export function VersionTimeline({
  publicId,
  activeVersion,
  headVersion,
  versions,
  canRevert = true,
  onSelectVersion,
}: VersionTimelineProps) {
  const revertMutation = useRevertArtifactMutation(publicId)
  const isHistorical = activeVersion < headVersion
  const ordered = [...versions].sort((a, b) => b.version - a.version)

  const handleRevert = async () => {
    try {
      const res = await revertMutation.mutateAsync({
        targetVersion: activeVersion,
        baseVersion: headVersion,
      })
      toast.success(`已基于 v${activeVersion} 生成新版本 v${res.version.version}`)
      onSelectVersion(undefined)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '回退版本失败')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`版本历史，当前 v${activeVersion}`}
          title={isHistorical ? `历史版本 v${activeVersion}` : '版本历史'}
          rightIcon={<ChevronDown size={12} />}
        >
          v{activeVersion}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>版本历史（共 {headVersion} 版）</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ordered.map((v) => {
          const isHead = v.version === headVersion
          const isCurrent = v.version === activeVersion
          return (
            <DropdownMenuItem
              key={v.version}
              onSelect={() => onSelectVersion(isHead ? undefined : v.version)}
              className="flex items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs font-semibold">v{v.version}</span>
                  {isHead ? <Badge tone="ok">最新</Badge> : null}
                  {isCurrent && !isHead ? <Badge tone="accent">当前</Badge> : null}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
                  {v.author} · {formatRelativeTime(v.createdAt)}
                </div>
              </div>
            </DropdownMenuItem>
          )
        })}
        {isHistorical ? (
          <>
            <DropdownMenuSeparator />
            {!ordered.some((v) => v.version === headVersion) ? (
              <DropdownMenuItem onSelect={() => onSelectVersion(undefined)}>
                回到最新
              </DropdownMenuItem>
            ) : null}
            {canRevert ? (
              <DropdownMenuItem
                disabled={revertMutation.isPending}
                onSelect={() => void handleRevert()}
              >
                <RotateCcw size={14} />
                回退到 v{activeVersion}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
