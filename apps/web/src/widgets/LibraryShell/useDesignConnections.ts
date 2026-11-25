import { useQuery } from '@tanstack/react-query'
import { fetchAgentConnections } from '@/features/agent-conversation'

/** 只有本机已授权的浏览器会拿到连接；库与表单共享同一次能力读取。 */
export function useDesignConnections(enabled: boolean) {
  return useQuery({
    queryKey: ['agent-connections'],
    queryFn: ({ signal }) => fetchAgentConnections(signal),
    enabled,
    retry: false,
    refetchInterval: 4000,
  })
}
