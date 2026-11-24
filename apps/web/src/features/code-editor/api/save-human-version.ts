import type { Artifact, Version } from '@akasha/protocol'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { artifactKeys, publishHumanVersion } from '@/entities/artifact'
import { feedbackKeys, notifyHumanVersionEdit } from '@/entities/feedback'

interface SaveHumanVersionVariables {
  artifact: Artifact
  /** 保存前的源码，用来生成给 Agent 的改动摘要。 */
  previousSource: string
  source: string
  /** 所基于的版本；落后于头版本时服务端返回 409。 */
  baseVersion: number
  title?: string
}

/** 保存新版本并更新编辑器使用的头版本缓存；分享会话不通知本机 Agent。 */
export function useSaveHumanVersionMutation(id: string, notifyAgent = true) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      input: SaveHumanVersionVariables,
    ): Promise<{ artifact: Artifact; version: Version }> => {
      const saved = await publishHumanVersion({
        project: input.artifact.projectId,
        slug: input.artifact.slug,
        title: input.title ?? input.artifact.title,
        type: input.artifact.type,
        source: input.source,
        baseVersion: input.baseVersion,
        visibility: input.artifact.visibility,
        author: 'human:web',
      })
      if (notifyAgent) {
        await notifyHumanVersionEdit(
          input.artifact.projectId,
          saved.version,
          input.previousSource,
          'code',
        )
      }
      return saved
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(artifactKeys.source(id, saved.version.version), saved.version)
      void queryClient.invalidateQueries({ queryKey: artifactKeys.versions(id) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(id) })
    },
  })
}
