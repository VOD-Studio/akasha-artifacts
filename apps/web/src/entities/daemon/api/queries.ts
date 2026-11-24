import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDaemonLogs, fetchDaemonStatus, stopDaemon } from './client'

/** 状态共用一个缓存键；日志按项目分键，无项目时使用全量键。 */
export const daemonKeys = {
  status: ['daemon', 'status'] as const,
  logs: (projectId?: string) => ['daemon', 'logs', projectId ?? 'all'] as const,
}

/** 共享 Daemon 状态快照，每 10 秒重读；失败最多重试一次。 */
export function useDaemonStatusQuery() {
  return useQuery({
    queryKey: daemonKeys.status,
    queryFn: fetchDaemonStatus,
    refetchInterval: 10_000,
    retry: 1,
  })
}

/** 按项目缓存最近 120 条日志；启用时每 4 秒重读，禁用时不自动请求。 */
export function useDaemonLogsQuery(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: daemonKeys.logs(projectId),
    queryFn: async () => {
      const res = await fetchDaemonLogs(projectId, 120)
      return res.entries
    },
    enabled,
    refetchInterval: enabled ? 4_000 : false,
  })
}

/** 收到停机受理回执后使状态缓存失效；成功只表示受理，不证明进程退出。 */
export function useStopDaemonMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: stopDaemon,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: daemonKeys.status })
    },
  })
}
