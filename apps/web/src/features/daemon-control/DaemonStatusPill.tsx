import type { DaemonStatus } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Activity, Power, RefreshCw, Terminal } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  useDaemonLogsQuery,
  useDaemonStatusQuery,
  useStopDaemonMutation,
} from '../../entities/daemon/queries'
import { useProjectsQuery } from '../../entities/project/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { formatUptime } from '../../shared/lib/format'

const RELAY_LABELS: Record<
  DaemonStatus['relayState'],
  { label: string; tone: 'neutral' | 'ok' | 'warning' | 'danger' }
> = {
  local_only: { label: '本地直连', tone: 'neutral' },
  connected: { label: '已连接云端', tone: 'ok' },
  degraded: { label: '云端连接不稳定', tone: 'warning' },
  rate_limited: { label: '云端连接受限', tone: 'danger' },
}

const LOG_LEVEL_STYLES = {
  error: 'font-semibold text-red-600',
  warn: 'font-semibold text-amber-600',
  info: 'text-ink-muted',
}

function serviceIndicator(online: boolean, reconnecting: boolean) {
  if (!online) return { label: '本地服务离线', tone: 'danger' } as const
  if (reconnecting) return { label: '本地服务重连中', tone: 'warning' } as const
  return { label: '本地服务', tone: 'ok' } as const
}

/**
 * 顶栏的 Daemon 运维胶囊：展示守护进程的版本、连接数与中继状态，以及按项目过滤的实时日志。
 *
 * @remarks 停止与重连操作需要二次确认。
 */
export function DaemonStatusPill() {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const [logProjectId, setLogProjectId] = useState<string>()
  const [confirmStop, setConfirmStop] = useState(false)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)

  const { data: status, isError, refetch } = useDaemonStatusQuery()
  const { data: projects = [] } = useProjectsQuery()
  const { data: logs = [] } = useDaemonLogsQuery(logProjectId, open)
  const stopMutation = useStopDaemonMutation()

  const online = Boolean(status) && !isError
  const indicator = serviceIndicator(online, wsStatus === 'reconnecting')
  const relayMeta = status && RELAY_LABELS[status.relayState]
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
      toast.success('已请求停止本地服务')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止本地服务失败')
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
        <Button variant="outline" size="sm" leftIcon={<Activity size={14} />}>
          <Badge tone={indicator.tone} className="border-0 bg-transparent p-0">
            {indicator.label}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent ref={setPanel} align="end" className="w-[420px] p-4">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-ink-muted" />
            <span className="text-sm font-semibold text-ink">本地服务</span>
          </div>
          {relayMeta && <Badge tone={relayMeta.tone}>{relayMeta.label}</Badge>}
        </div>

        {status ? (
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/50 p-2.5 text-xs">
            <div>
              <span className="text-ink-muted">版本 / PID：</span>
              <span className="font-mono text-ink">
                v{status.version} (#{status.pid})
              </span>
            </div>
            <div>
              <span className="text-ink-muted">运行时长：</span>
              <span className="font-mono text-ink">{formatUptime(status.uptimeSec)}</span>
            </div>
            <div>
              <span className="text-ink-muted">网页 / 沙盒端口：</span>
              <span className="font-mono text-ink">
                {status.port} / {status.sandboxPort}
              </span>
            </div>
            <div>
              <span className="text-ink-muted">连接数 / 项目数：</span>
              <span className="font-mono text-ink">
                {status.activeConnections} / {status.projectCount}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-ink-muted">
            无法连接本地服务。在终端运行 <code>akasha serve</code>。
          </div>
        )}

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
              <Terminal size={13} />
              日志
            </span>
            <Select value={logFilter} onValueChange={selectLogProject}>
              <SelectTrigger aria-label="按项目筛选日志" controlSize="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent container={panel}>
                <SelectItem value="all">全部项目</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScrollArea
            aria-label="本地服务日志"
            className="h-44 rounded-lg border border-border bg-surface-subtle p-2"
          >
            {logs.length === 0 ? (
              <div className="py-6 text-center text-xs text-ink-muted">暂无日志</div>
            ) : (
              <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                {logs.map((entry) => (
                  <div
                    key={`${entry.timestamp}-${entry.level}-${entry.message}`}
                    className="break-all border-b border-border/40 pb-1 last:border-b-0"
                  >
                    <span className="text-ink-muted">{entry.timestamp.slice(11, 19)}</span>{' '}
                    <span className={LOG_LEVEL_STYLES[entry.level]}>[{entry.level}]</span>{' '}
                    <span className="text-ink">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {confirmStop && (
          <p role="status" className="mt-3 text-xs text-ink-muted">
            本机作品将无法访问，直至重新启动服务。
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={13} />}
            onClick={() => void refetch()}
          >
            刷新
          </Button>
          <div className="flex items-center gap-1.5">
            {confirmStop ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmStop(false)}>
                取消
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
              {confirmStop ? '确认停止' : '停止服务'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
