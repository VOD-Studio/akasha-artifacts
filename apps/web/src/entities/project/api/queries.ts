import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchProjects, removeProject } from './client'

/** 项目列表读取与移除后的失效操作共用此缓存键。 */
export const projectKeys = {
  all: ['projects'] as const,
}

/** 共享项目列表，缓存 10 秒内视为新鲜；提供毫秒间隔时才开启轮询。 */
export function useProjectsQuery(refetchInterval?: number) {
  return useQuery({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const res = await fetchProjects()
      return res.projects
    },
    staleTime: 10_000,
    refetchInterval,
  })
}

/** 仅移除成功后使项目列表缓存失效；重新读取结果以服务端为准。 */
export function useRemoveProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => removeProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
