import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type AnnotationThreadAction,
  fetchArtifactFeedback,
  updateAnnotationThread,
} from './client'

/** 反馈按作品归集；固定版本和页面范围由读取方在这份列表内筛选。 */
export const feedbackKeys = {
  all: ['feedback'] as const,
  list: (artifactId: string) => ['feedback', artifactId] as const,
}

/** 读取服务端可见的草稿与线程；未选作品时不发请求。 */
export function useArtifactFeedbackQuery(artifactId: string) {
  return useQuery({
    queryKey: feedbackKeys.list(artifactId),
    queryFn: () => fetchArtifactFeedback(artifactId),
    enabled: Boolean(artifactId),
    staleTime: 2_000,
  })
}

/** 回复或解决线程后等反馈缓存刷新，不重读作品详情，也不重新投递 Agent。 */
export function useAnnotationThreadMutation(artifactId: string, id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: AnnotationThreadAction) => updateAnnotationThread(artifactId, id, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) }),
  })
}
