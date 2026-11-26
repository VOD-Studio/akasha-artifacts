import type { VersionSummary } from '@akasha/protocol'
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
import { useRevertArtifactMutation } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { formatRelativeTime } from '@/shared/lib/format'
import { messages } from './messages'

export interface VersionTimelineProps {
  publicId: string
  activeVersion: number
  headVersion: number
  versions: readonly VersionSummary[]
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
  const { t, locale, dir } = useMessages(messages)
  const revertMutation = useRevertArtifactMutation(publicId)
  const isHistorical = activeVersion < headVersion
  const ordered = [...versions].sort((a, b) => b.version - a.version)
  const showLatestLink = isHistorical && !ordered.some((v) => v.version === headVersion)
  const showRevert = isHistorical && canRevert

  const handleRevert = async () => {
    try {
      const res = await revertMutation.mutateAsync({
        targetVersion: activeVersion,
        baseVersion: headVersion,
      })
      toast.success(
        t('已将 {from} 恢复为 {to}', { from: `v${activeVersion}`, to: `v${res.version.version}` }),
      )
      onSelectVersion(undefined)
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t('恢复版本失败')))
    }
  }

  return (
    <DropdownMenu dir={dir}>
      <DropdownMenuTrigger asChild>
        <Button
          variant={isHistorical ? 'secondary' : 'ghost'}
          size="sm"
          className="font-mono text-xs text-ink-muted tabular-nums hover:text-ink"
          aria-label={t('版本历史，当前 {version}', { version: `v${activeVersion}` })}
          title={
            isHistorical ? t('历史版本 {version}', { version: `v${activeVersion}` }) : t('版本历史')
          }
          rightIcon={<ChevronDown size={12} className="disclosure-chevron" />}
        >
          {isHistorical ? (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
          ) : null}
          <bdi dir="ltr">v{activeVersion}</bdi>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('版本历史')}</DropdownMenuLabel>
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
                  <bdi dir="ltr" className="font-mono text-xs font-semibold">
                    v{v.version}
                  </bdi>
                  {isHead ? <Badge tone="ok">{t('最新')}</Badge> : null}
                  {isCurrent && !isHead ? <Badge tone="accent">{t('当前')}</Badge> : null}
                </div>
                <div className="truncate text-[11px] text-ink-muted">
                  <bdi>{v.author}</bdi> ·{' '}
                  <time dateTime={v.createdAt}>
                    {formatRelativeTime(v.createdAt, undefined, locale)}
                  </time>
                </div>
              </div>
            </DropdownMenuItem>
          )
        })}
        {isHistorical && <DropdownMenuSeparator />}
        {showLatestLink && (
          <DropdownMenuItem onSelect={() => onSelectVersion(undefined)}>
            {t('查看最新版本')}
          </DropdownMenuItem>
        )}
        {showRevert && (
          <DropdownMenuItem
            disabled={revertMutation.isPending}
            onSelect={() => void handleRevert()}
          >
            <RotateCcw size={14} />
            {t('将 {version} 恢复为新版本', { version: `v${activeVersion}` })}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
