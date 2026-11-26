import { useMutation, useQueryClient } from '@tanstack/react-query'
import { artifactKeys } from '@/entities/artifact'
import { feedbackKeys } from '@/entities/feedback'

/** 重读当前作品、权限和反馈，不刷新页面，也不清除画布或未保存输入。 */
export function useReloadArtifactMutation(id: string, projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await Promise.all([
        queryClient.invalidateQueries(
          { queryKey: artifactKeys.detailPrefix(id) },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: artifactKeys.versions(id) },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries(
          { queryKey: artifactKeys.management(id, projectId) },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries({ queryKey: feedbackKeys.list(id) }, { throwOnError: true }),
      ])
    },
  })
}
