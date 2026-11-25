import type { Project } from '@akasha/protocol'
import { useQuery } from '@tanstack/react-query'
import { fetchAgentConnections } from '../api/client'

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

/** 已获本机授权才能管理库；新会话还需要可用连接和当前库中的项目。 */
export function useDesignAvailability(enabled: boolean, projects: ReadonlyMap<string, Project>) {
  const connections = useDesignConnections(enabled)
  return {
    authorized: enabled && connections.isSuccess,
    canCreate:
      enabled &&
      connections.isSuccess &&
      connections.data.connections.some(
        (entry) => entry.availability === 'ready' && projects.has(entry.projectId),
      ),
  }
}
