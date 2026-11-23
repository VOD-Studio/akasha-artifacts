import type { Artifact, ArtifactType, JsonPatchOp, Version } from '@akasha/protocol'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ArtifactDetailResponse,
  fetchArtifactDetail,
  fetchArtifactFavorites,
  fetchArtifactManagement,
  fetchArtifactSpec,
  fetchArtifactStorageUsage,
  fetchArtifacts,
  fetchArtifactVersions,
  publishHumanVersion,
  pushArtifactState,
  renameArtifact,
  revertArtifactVersion,
  setArtifactFavorite,
  submitArtifactFeedback,
} from '../../shared/api/client'
import { computeLineDiff } from '../../shared/lib/diff'
import { feedbackKeys } from '../feedback/queries'

const artifactListKey = ['artifacts', 'list'] as const

export const artifactKeys = {
  all: ['artifacts'] as const,
  lists: artifactListKey,
  list: (projectId?: string) => [...artifactListKey, projectId ?? 'all'] as const,
  detailPrefix: (id: string) => ['artifacts', 'detail', id] as const,
  detail: (id: string, version?: number) => ['artifacts', 'detail', id, version ?? 'head'] as const,
  versions: (id: string) => ['artifacts', 'versions', id] as const,
  management: (id: string) => ['artifacts', 'management', id] as const,
  favorites: ['artifact-favorites'] as const,
  storageUsage: (id: string) => ['artifacts', 'storage-usage', id] as const,
  spec: (type: ArtifactType) => ['artifacts', 'spec', type] as const,
}

export function useArtifactsQuery(projectId?: string, refetchInterval?: number) {
  return useQuery({
    queryKey: artifactKeys.list(projectId),
    queryFn: async () => {
      const res = await fetchArtifacts(projectId)
      return res.artifacts
    },
    staleTime: 5_000,
    refetchInterval,
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

export function useArtifactManagementQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.management(id),
    queryFn: () => fetchArtifactManagement(id),
    enabled: Boolean(id),
    retry: false,
  })
}

export function useRenameArtifactMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => renameArtifact(id, title),
    onSuccess: ({ artifact }) => {
      queryClient.setQueriesData<ArtifactDetailResponse>(
        { queryKey: artifactKeys.detailPrefix(id) },
        (previous) => (previous ? { ...previous, artifact } : previous),
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.lists })
    },
  })
}

export function useArtifactFavoritesQuery() {
  return useQuery({
    queryKey: artifactKeys.favorites,
    queryFn: async () => (await fetchArtifactFavorites()).artifactIds,
    retry: false,
  })
}

export function useSetArtifactFavoriteMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (favorite: boolean) => setArtifactFavorite(id, favorite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: artifactKeys.favorites }),
  })
}

export function useArtifactStorageUsageQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.storageUsage(id),
    queryFn: () => fetchArtifactStorageUsage(id),
    retry: false,
  })
}

/** 重读当前制品的数据，不重载浏览器，不重置画布与输入。 */
export function useReloadArtifactMutation(id: string) {
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
          { queryKey: artifactKeys.management(id) },
          { throwOnError: true },
        ),
        queryClient.invalidateQueries({ queryKey: feedbackKeys.list(id) }, { throwOnError: true }),
      ])
    },
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
  origin: 'code' | 'canvas',
): string {
  const diff = computeLineDiff(previousSource, nextSource)
  const added = diff.filter((l) => l.kind === 'added').length
  const removed = diff.filter((l) => l.kind === 'removed').length
  const changedPreview = diff
    .filter((l) => l.kind !== 'context')
    .slice(0, 12)
    .map((l) => `${l.kind === 'added' ? '+' : '-'}${l.text}`)
    .join('\n')
  const editor = origin === 'canvas' ? '在画布' : '在 L3 代码编辑器'
  return `人类${editor}直接保存了 v${nextVersion}（+${added} / -${removed} 行）${
    changedPreview ? `\n${changedPreview}` : ''
  }`
}

/** 反馈指向确认落盘的版本；通知失败不把已经提交的版本标记为保存失败。 */
export async function notifyHumanVersionEdit(
  projectId: string,
  version: Version,
  previousSource: string,
  origin: 'code' | 'canvas',
) {
  try {
    await submitArtifactFeedback(version.artifactId, {
      project: projectId,
      version: version.version,
      roundId: null,
      kind: 'edit',
      element: null,
      body: summarizeHumanEdit(previousSource, version.source, version.version, origin),
    })
  } catch {
    // 版本已经落盘，Agent 通知失败不回滚保存。
  }
}

export interface SaveHumanVersionVariables {
  artifact: Artifact
  /** 保存前的源码，用来生成给 Agent 的改动摘要。 */
  previousSource: string
  source: string
  /** 所基于的版本；落后于头版本时服务端返回 409。 */
  baseVersion: number
  title?: string
}

/**
 * 保存人类在 L3 代码编辑器里直接改动的新版本，作者记为 `human:web`。
 *
 * @remarks 保存成功后自动写入一条 `kind=edit` 的反馈，把改动摘要通知 Agent。
 */
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
      await notifyHumanVersionEdit(
        input.artifact.projectId,
        saved.version,
        input.previousSource,
        'code',
      )
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
