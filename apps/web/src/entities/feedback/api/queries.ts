import type { ArtifactSharedAccess } from '@akasha/protocol'
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

/** 受邀会话与固定快照隔离反馈缓存；不能复用作者曾读到的内部讨论和草稿。 */
export function useArtifactFeedbackQuery(
  artifactId: string,
  access: ArtifactSharedAccess | undefined,
  enabled: boolean,
) {
  const key = feedbackKeys.list(artifactId)
  return useQuery({
    queryKey: access ? [...key, 'shared', access.version ?? 'head'] : key,
    queryFn: () => fetchArtifactFeedback(artifactId),
    enabled: enabled && Boolean(artifactId),
    staleTime: 2_000,
    refetchInterval: (query) => {
      const threads = query.state.data?.threads
      if (!threads) return false
      return Object.values(threads).some(
        (thread) => thread.agent?.state === 'queued' || thread.agent?.state === 'running',
      )
        ? 1_500
        : false
    },
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
