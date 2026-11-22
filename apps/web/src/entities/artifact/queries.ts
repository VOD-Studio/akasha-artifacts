import type { Artifact, ArtifactType, JsonPatchOp, Version } from '@akasha/protocol'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ArtifactDetailResponse,
  fetchArtifactDetail,
  fetchArtifactSpec,
  fetchArtifacts,
  fetchArtifactVersions,
  publishHumanVersion,
  pushArtifactState,
  revertArtifactVersion,
  submitArtifactFeedback,
} from '../../shared/api/client'
import { computeLineDiff } from '../../shared/lib/diff'
import { feedbackKeys } from '../feedback/queries'

export const artifactKeys = {
  all: ['artifacts'] as const,
  list: (projectId?: string) => ['artifacts', 'list', projectId ?? 'all'] as const,
  detailPrefix: (id: string) => ['artifacts', 'detail', id] as const,
  detail: (id: string, version?: number) => ['artifacts', 'detail', id, version ?? 'head'] as const,
  versions: (id: string) => ['artifacts', 'versions', id] as const,
  spec: (type: ArtifactType) => ['artifacts', 'spec', type] as const,
}

export function useArtifactsQuery(projectId?: string) {
  return useQuery({
    queryKey: artifactKeys.list(projectId),
    queryFn: async () => {
      const res = await fetchArtifacts(projectId)
      return res.artifacts
    },
    staleTime: 5_000,
  })
}

export function useArtifactDetailQuery(id: string, version?: number) {
  return useQuery({
    queryKey: artifactKeys.detail(id, version),
    queryFn: () => fetchArtifactDetail(id, version),
    enabled: Boolean(id),
    staleTime: 2_000,
  })
}

export function useArtifactVersionsQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.versions(id),
    queryFn: async () => {
      const res = await fetchArtifactVersions(id)
      return res.versions
    },
    enabled: Boolean(id),
    staleTime: 5_000,
  })
}

export function useRevertArtifactMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { targetVersion: number; baseVersion: number }) =>
      revertArtifactVersion(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
    },
  })
}

export function useArtifactSpecQuery(type: ArtifactType, enabled = true) {
  return useQuery({
    queryKey: artifactKeys.spec(type),
    queryFn: () => fetchArtifactSpec(type),
    enabled,
    staleTime: 60_000,
  })
}

export function usePushArtifactStateMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { project?: string; patch: JsonPatchOp[] }) => pushArtifactState(id, input),
    onSuccess: (res) => {
      queryClient.setQueriesData<ArtifactDetailResponse>(
        { queryKey: artifactKeys.detailPrefix(id) },
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            state: {
              ...prev.state,
              seq: res.seq,
              snapshot: res.snapshot,
            },
          }
        },
      )
    },
  })
}

function summarizeHumanEdit(
  previousSource: string,
  nextSource: string,
  nextVersion: number,
): string {
  const diff = computeLineDiff(previousSource, nextSource)
  const added = diff.filter((l) => l.kind === 'added').length
  const removed = diff.filter((l) => l.kind === 'removed').length
  const changedPreview = diff
    .filter((l) => l.kind !== 'context')
    .slice(0, 12)
    .map((l) => `${l.kind === 'added' ? '+' : '-'}${l.text}`)
    .join('\n')
  return `人类在 L3 代码编辑器直接保存了 v${nextVersion}（+${added} / -${removed} 行）${
    changedPreview ? `\n${changedPreview}` : ''
  }`
}

export interface SaveHumanVersionVariables {
  artifact: Artifact
  previousSource: string
  source: string
  baseVersion: number
  title?: string
}

// 保存人类 L3 直接编辑的新版本（author='human:web'），并自动写入 kind='edit' 反馈通知 Agent。
export function useSaveHumanVersionMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      input: SaveHumanVersionVariables,
    ): Promise<{
      artifact: Artifact
      version: Version
    }> => {
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
      try {
        await submitArtifactFeedback(id, {
          project: input.artifact.projectId,
          version: saved.version.version,
          roundId: null,
          kind: 'edit',
          element: null,
          body: summarizeHumanEdit(input.previousSource, input.source, saved.version.version),
        })
      } catch {
        // 版本已成功落盘；edit 反馈通知失败不回滚已保存版本
      }
      return saved
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<ArtifactDetailResponse | undefined>(
        artifactKeys.detail(id, undefined),
        (prev) => {
          if (!prev) return prev
          return {
            ...prev,
            artifact: saved.artifact,
            version: saved.version,
          }
        },
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.versions(id) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.all })
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(id) })
    },
  })
}
