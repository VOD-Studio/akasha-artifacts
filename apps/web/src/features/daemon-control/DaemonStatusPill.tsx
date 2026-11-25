import type { DaemonStatus } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Activity, Power, RefreshCw, Terminal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDaemonLogsQuery, useDaemonStatusQuery, useStopDaemonMutation } from '@/entities/daemon'
import { useProjectsQuery } from '@/entities/project'
import { useWorkspaceStore } from '@/entities/workspace'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { formatUptime } from '@/shared/lib/format'
import { messages } from './messages'

const RELAY_LABELS = {
  local_only: { label: '本地直连', tone: 'neutral' },
  connected: { label: '已连接云端', tone: 'ok' },
  degraded: { label: '云端连接不稳定', tone: 'warning' },
  rate_limited: { label: '云端连接受限', tone: 'danger' },
} as const satisfies Record<
  DaemonStatus['relayState'],
  { label: keyof typeof messages; tone: 'neutral' | 'ok' | 'warning' | 'danger' }
>

const LOG_LEVEL_STYLES = {
  error: 'font-semibold text-red-600',
  warn: 'font-semibold text-amber-600',
  info: 'text-ink-muted',
}

const DOT_STYLES = {
  ok: 'bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_20%,transparent)]',
  warning: 'bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_22%,transparent)]',
  danger:
    'bg-destructive shadow-[0_0_0_3px_color-mix(in_oklab,var(--destructive)_20%,transparent)]',
  neutral: 'bg-muted-foreground/60',
} as const

function serviceIndicator(error: Error | null, pending: boolean, reconnecting: boolean) {
  if (pending) return { label: '正在连接本地服务…', tone: 'neutral' } as const
  if (error instanceof ApiError) return { label: '无法读取本地服务状态', tone: 'warning' } as const
  if (error) return { label: '本地服务离线', tone: 'danger' } as const
  if (reconnecting) return { label: '本地服务重连中', tone: 'warning' } as const
  return { label: '本地服务', tone: 'ok' } as const
}

/**
 * 顶栏的 Daemon 运维胶囊：展示守护进程的版本、连接数与中继状态，以及按项目过滤的实时日志。
 *
 * @remarks 停止操作需要二次确认。
 */
export function DaemonStatusPill() {
  const { t, locale, dir, date, number } = useMessages(messages)
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const [logProjectId, setLogProjectId] = useState<string>()
  const [confirmStop, setConfirmStop] = useState(false)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)

  const { data: status, error, isPending, isFetching, refetch } = useDaemonStatusQuery()
  const online = Boolean(status) && !error
  const { data: projects = [] } = useProjectsQuery()
  const logsQuery = useDaemonLogsQuery(logProjectId, open && online)
  const logs = logsQuery.data ?? []
  const stopMutation = useStopDaemonMutation()

  const indicator = serviceIndicator(error, isPending, wsStatus === 'reconnecting')
  const relayMeta = online && status && RELAY_LABELS[status.relayState]
  const logFilter = logProjectId === undefined ? 'all' : `project:${logProjectId}`

  const selectLogProject = (value: string) => {
    setLogProjectId(value === 'all' ? undefined : value.slice('project:'.length))
  }

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true)
      return
    }
    try {
      await stopMutation.mutateAsync()
      setConfirmStop(false)
      toast.success(t('已请求停止本地服务'))
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t('停止本地服务失败')))
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setConfirmStop(false)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-ink-muted hover:text-ink">
          <span
            aria-hidden="true"
            className={`size-1.5 shrink-0 rounded-full ${DOT_STYLES[indicator.tone]}`}
          />
          <span className="sr-only sm:not-sr-only">{t(indicator.label)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        dir={dir}
        ref={setPanel}
        align="end"
        className="w-[min(26.25rem,calc(100vw-1rem))] p-4"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-ink-muted" />
            <span className="text-sm font-semibold text-ink">{t('本地服务')}</span>
          </div>
          {relayMeta && <Badge tone={relayMeta.tone}>{t(relayMeta.label)}</Badge>}
        </div>

        {online && status && (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
            <div>
              <span className="text-ink-muted">{t('版本 / PID：')}</span>
              <span dir="ltr" className="inline-block font-mono text-ink">
                v{status.version} (#{status.pid})
              </span>
            </div>
            <div>
              <span className="text-ink-muted">{t('运行时长：')}</span>
              <span className="font-mono text-ink">{formatUptime(status.uptimeSec, locale)}</span>
            </div>
            <div>
              <span className="text-ink-muted">{t('网页 / 沙盒端口：')}</span>
              <span dir="ltr" className="inline-block font-mono text-ink">
                {status.port} / {status.sandboxPort}
              </span>
            </div>
            <div>
              <span className="text-ink-muted">{t('连接数 / 项目数：')}</span>
              <span className="font-mono text-ink">
                {number(status.activeConnections)} / {number(status.projectCount)}
              </span>
            </div>
          </div>
        )}
        {error instanceof ApiError && (
          <p role="alert" className="mt-3 text-xs">
            {getRequestErrorMessage(error)}
          </p>
        )}
        {error && !(error instanceof ApiError) && (
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-ink-muted">
            {t('无法连接本地服务。在终端运行')} <code dir="ltr">akasha serve</code>
          </div>
        )}

        {online && (
          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
                <Terminal size={13} />
                {t('日志')}
              </span>
              <Select value={logFilter} onValueChange={selectLogProject}>
                <SelectTrigger aria-label={t('按项目筛选日志')} controlSize="sm" className="w-40">
                  <SelectValue dir="auto" />
                </SelectTrigger>
                <SelectContent container={panel}>
                  <SelectItem value="all">{t('全部项目')}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={`project:${project.id}`}>
                      <bdi>{project.name}</bdi>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <ScrollArea
              aria-label={t('本地服务日志')}
              className="h-44 rounded-lg border border-border bg-surface-subtle p-2"
            >
              {logsQuery.isPending && <p role="status">{t('正在读取日志…')}</p>}
              {logsQuery.isError && (
                <p role="alert">{getRequestErrorMessage(logsQuery.error, t('无法读取日志'))}</p>
              )}
              {logsQuery.isSuccess && !logs.length && (
                <div className="py-6 text-center text-xs text-ink-muted">{t('暂无日志')}</div>
              )}
              {logsQuery.isSuccess && logs.length > 0 && (
                <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                  {logs.map((entry) => (
                    <div
                      key={`${entry.timestamp}-${entry.level}-${entry.message}`}
                      className="break-all border-b border-border/40 pb-1 last:border-b-0"
                    >
                      <time
                        dir="ltr"
                        dateTime={entry.timestamp}
                        className="inline-block text-ink-muted"
                      >
                        {date(new Date(entry.timestamp), {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hourCycle: 'h23',
                        })}
                      </time>{' '}
                      <bdi dir="ltr" className={LOG_LEVEL_STYLES[entry.level]}>
                        [{entry.level}]
                      </bdi>{' '}
                      <bdi className="text-ink">{entry.message}</bdi>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {online && confirmStop && (
          <p role="status" className="mt-3 text-xs text-ink-muted">
            {t('本机作品将无法访问，直至重新启动服务。')}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={13} />}
            loading={isFetching}
            onClick={() => void refetch()}
          >
            {t('刷新')}
          </Button>
          {online && (
            <div className="flex items-center gap-1.5">
              {confirmStop ? (
                <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>
                  {t('取消')}
                </Button>
              ) : null}
              <Button
                variant={confirmStop ? 'destructive' : 'outline'}
                size="sm"
                leftIcon={<Power size={13} />}
                disabled={!online}
                loading={stopMutation.isPending}
                onClick={() => void handleStop()}
              >
                {t(confirmStop ? '确认停止' : '停止服务')}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
