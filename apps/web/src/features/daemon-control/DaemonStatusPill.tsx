import type { DaemonStatus } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@akasha/ui/popover'
import { ScrollArea } from '@akasha/ui/scroll-area'
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
  connected: { label: '云端已连', tone: 'ok' },
  degraded: { label: '云端降级', tone: 'warning' },
  rate_limited: { label: '中继限流', tone: 'danger' },
}

/**
 * 顶栏的 Daemon 运维胶囊：展示守护进程的版本、连接数与中继状态，以及按项目过滤的实时日志。
 *
 * @remarks 停止与重连操作需要二次确认。
 */
export function DaemonStatusPill() {
  const [open, setOpen] = useState(false)
  const [logProjectId, setLogProjectId] = useState<string>('')
  const [confirmStop, setConfirmStop] = useState(false)
  const wsStatus = useWorkspaceStore((s) => s.wsStatus)

  const { data: status, isError, refetch } = useDaemonStatusQuery()
  const { data: projects = [] } = useProjectsQuery()
  const { data: logs = [] } = useDaemonLogsQuery(logProjectId || undefined, open)
  const stopMutation = useStopDaemonMutation()

  const online = Boolean(status) && !isError
  const pillTone = !online ? 'danger' : wsStatus === 'reconnecting' ? 'warning' : 'ok'
  const relayMeta = status ? RELAY_LABELS[status.relayState] : RELAY_LABELS.local_only

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true)
      return
    }
    try {
      await stopMutation.mutateAsync()
      setConfirmStop(false)
      toast.success('已向本机 Akasha Daemon 发送停止信号')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止 Daemon 失败')
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
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-muted"
          aria-label="Daemon 运维状态"
        >
          <Badge tone={pillTone} className="border-0 bg-transparent px-0 py-0">
            {online ? `Daemon v${status?.version}` : 'Daemon 离线'}
          </Badge>
          {online && status ? (
            <span className="text-[11px] text-ink-muted">:{status.port}</span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-4">
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Activity size={15} className="text-ink-muted" />
            <span className="text-sm font-semibold text-ink">Akasha Local Daemon</span>
          </div>
          <Badge tone={relayMeta.tone}>{relayMeta.label}</Badge>
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
              <span className="text-ink-muted">外壳 / 沙盒端口：</span>
              <span className="font-mono text-ink">
                {status.port} / {status.sandboxPort}
              </span>
            </div>
            <div>
              <span className="text-ink-muted">活跃连接 / 项目：</span>
              <span className="font-mono text-ink">
                {status.activeConnections} / {status.projectCount}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-muted/50 p-3 text-xs text-ink-muted">
            当前无法连接本机 Daemon，请确认已运行 <code>akasha serve</code>。
          </div>
        )}

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
              <Terminal size={13} />
              近期日志
            </span>
            <select
              aria-label="按项目过滤日志"
              value={logProjectId}
              onChange={(e) => setLogProjectId(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-ink"
            >
              <option value="">全部项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <ScrollArea
            aria-label="Daemon 近期日志"
            className="h-44 rounded-lg border border-border bg-surface-subtle p-2"
          >
            {logs.length === 0 ? (
              <div className="py-6 text-center text-xs text-ink-muted">暂无日志记录</div>
            ) : (
              <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                {logs.map((entry) => (
                  <div
                    key={`${entry.timestamp}-${entry.level}-${entry.message}`}
                    className="break-all border-b border-border/40 pb-1 last:border-b-0"
                  >
                    <span className="text-ink-muted">{entry.timestamp.slice(11, 19)}</span>{' '}
                    <span
                      className={
                        entry.level === 'error'
                          ? 'font-semibold text-red-600'
                          : entry.level === 'warn'
                            ? 'font-semibold text-amber-600'
                            : 'text-emerald-700'
                      }
                    >
                      [{entry.level}]
                    </span>{' '}
                    <span className="text-ink">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw size={13} />}
            onClick={() => void refetch()}
          >
            刷新状态
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
              disabled={!online || stopMutation.isPending}
              onClick={() => void handleStop()}
            >
              {confirmStop ? '确认停止 Daemon' : '停止 Daemon'}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
