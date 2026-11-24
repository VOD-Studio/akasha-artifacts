import type { DaemonStatus } from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/** Daemon 内存日志中的诊断条目。 */
export interface DaemonLogEntry {
  /** 写入缓冲区时的 ISO 8601 时间戳。 */
  timestamp: string
  /** 诊断级别，不代表对应请求的 HTTP 状态。 */
  level: 'info' | 'warn' | 'error'
  /** 与具体项目无关时省略。 */
  projectId?: string
  /** 条目关联的制品标识；不保证每条日志都携带。 */
  artifactId?: string
  /** 日志正文。 */
  message: string
}

/** 读取当前进程的运行快照；无法连接时请求拒绝，不会返回离线状态。 */
export async function fetchDaemonStatus(): Promise<DaemonStatus> {
  return requestJson<DaemonStatus>('/api/v1/daemon/status')
}

/**
 * 读取内存中最近保留的日志，结果按写入顺序从旧到新，不包含已淘汰的条目。
 *
 * @param projectId - 省略或空串时不过滤，包含不归属任何项目的日志。
 * @param limit - 默认取 100 条；服务端把 0 当作默认值，其余整数限制在 1–300。
 */
export async function fetchDaemonLogs(
  projectId?: string,
  limit = 100,
): Promise<{ entries: DaemonLogEntry[] }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (projectId) params.set('projectId', projectId)
  return requestJson<{ entries: DaemonLogEntry[] }>(`/api/v1/daemon/logs?${params.toString()}`)
}

/** 返回表示 Daemon 已接受停机；不代表进程已退出。 */
export async function stopDaemon(): Promise<{ ok: true; status: 'stopping' }> {
  return requestJson<{ ok: true; status: 'stopping' }>('/api/v1/daemon/shutdown', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}
