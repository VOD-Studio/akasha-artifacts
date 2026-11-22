import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchDaemonLogs, fetchDaemonStatus, stopDaemon } from '../../shared/api/client'

export const daemonKeys = {
  status: ['daemon', 'status'] as const,
  logs: (projectId?: string) => ['daemon', 'logs', projectId ?? 'all'] as const,
}

export function useDaemonStatusQuery() {
  return useQuery({
    queryKey: daemonKeys.status,
    queryFn: fetchDaemonStatus,
    refetchInterval: 10_000,
    retry: 1,
  })
}

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

export function useStopDaemonMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: stopDaemon,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: daemonKeys.status })
    },
  })
}
