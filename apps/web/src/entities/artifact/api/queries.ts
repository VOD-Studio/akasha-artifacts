import type { ArtifactType, ArtifactWorkspaceDetail, JsonPatchOp } from '@akasha/protocol'
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchArtifactDetail,
  fetchArtifactFavorites,
  fetchArtifactManagement,
  fetchArtifactSpec,
  fetchArtifactStorageUsage,
  fetchArtifacts,
  fetchArtifactVersions,
  fetchArtifactWorkspace,
  pushArtifactState,
  renameArtifact,
  revertArtifactVersion,
  setArtifactFavorite,
} from './client'

const artifactListKey = ['artifacts', 'list'] as const

/** 工作区按版本缓存；源码与其它查询不落在详情前缀之下。 */
export const artifactKeys = {
  all: ['artifacts'] as const,
  lists: artifactListKey,
  list: (projectId?: string) => [...artifactListKey, projectId ?? 'all'] as const,
  detailPrefix: (id: string) => ['artifacts', 'detail', id] as const,
  canvas: (id: string, version?: number) =>
    [...artifactKeys.detailPrefix(id), version ?? 'head'] as const,
  source: (id: string, version: number) => ['artifacts', 'source', id, version] as const,
  versions: (id: string) => ['artifacts', 'versions', id] as const,
  management: (id: string) => ['artifacts', 'management', id] as const,
  withdrawn: ['artifacts', 'withdrawn'] as const,
  favorites: ['artifact-favorites'] as const,
  storageUsage: (id: string) => ['artifacts', 'storage-usage', id] as const,
  spec: (type: ArtifactType) => ['artifacts', 'spec', type] as const,
}

/** 未指定项目时读整个可见作品库；只有调用方指定间隔时才轮询。 */
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

/** 工作台使用布局详情；完整源码不与该查询共享缓存值。 */
export function useArtifactWorkspaceQuery(id: string, version?: number) {
  return useQuery({
    queryKey: artifactKeys.canvas(id, version),
    queryFn: ({ signal }) => fetchArtifactWorkspace(id, version, signal),
    enabled: Boolean(id),
    staleTime: 2_000,
  })
}

/** 编辑和导出只读取正被操作的不可变版本。 */
export function artifactSourceOptions(id: string, version: number) {
  return queryOptions({
    queryKey: artifactKeys.source(id, version),
    queryFn: async ({ signal }) => (await fetchArtifactDetail(id, version, signal)).version,
    staleTime: 20_000,
    gcTime: 60_000,
  })
}

/** 非源码工具不会启动全文请求；独立作品可直接重用详情中的全文。 */
export function useArtifactSourceQuery(id: string, version?: number, enabled = true) {
  return useQuery({
    ...artifactSourceOptions(id, version ?? 0),
    enabled: enabled && Boolean(id) && version !== undefined,
  })
}

/** 版本历史按作品缓存，切换当前快照不会重新创建一份历史缓存。 */
export function useArtifactVersionsQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.versions(id),
    queryFn: async ({ signal }) => {
      const res = await fetchArtifactVersions(id, signal)
      return res.versions
    },
    enabled: Boolean(id),
    staleTime: 5_000,
  })
}

/** 管理权限独立于详情读取；失败时不在此 hook 重试。 */
export function useArtifactManagementQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.management(id),
    queryFn: () => fetchArtifactManagement(id),
    enabled: Boolean(id),
    retry: false,
  })
}

/** 保存后更新已打开快照的展示名，并通知所有项目列表刷新。 */
export function useRenameArtifactMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => renameArtifact(id, title),
    onSuccess: ({ artifact }) => {
      queryClient.setQueriesData<ArtifactWorkspaceDetail>(
        { queryKey: artifactKeys.detailPrefix(id) },
        (previous) => (previous ? { ...previous, artifact } : previous),
      )
      void queryClient.invalidateQueries({ queryKey: artifactKeys.lists })
    },
  })
}

/** 收藏属于当前身份，读取失败不重试；无收藏必须由服务端返回空列表。 */
export function useArtifactFavoritesQuery() {
  return useQuery({
    queryKey: artifactKeys.favorites,
    queryFn: async () => (await fetchArtifactFavorites()).artifactIds,
    retry: false,
  })
}

/** 写入目标收藏态，等收藏列表刷新后再结束保存状态。 */
export function useSetArtifactFavoriteMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (favorite: boolean) => setArtifactFavorite(id, favorite),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: artifactKeys.favorites }),
  })
}

/** 只用于查看当前作品的运行存储，读取失败留给用量弹窗处理。 */
export function useArtifactStorageUsageQuery(id: string) {
  return useQuery({
    queryKey: artifactKeys.storageUsage(id),
    queryFn: () => fetchArtifactStorageUsage(id),
    retry: false,
  })
}

/** 恢复历史快照为新版本；写入成功后让详情、列表与版本历史重新读取。 */
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

/** 按作品类型共享规格缓存；没有运行参数入口的视图可以关闭请求。 */
export function useArtifactSpecQuery(type: ArtifactType, enabled = true) {
  return useQuery({
    queryKey: artifactKeys.spec(type),
    queryFn: () => fetchArtifactSpec(type),
    enabled,
    staleTime: 60_000,
  })
}

/** 写入运行状态后把服务端序号和快照同步到已缓存的详情，不更改源码版本。 */
export function usePushArtifactStateMutation(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { project?: string; patch: JsonPatchOp[] }) => pushArtifactState(id, input),
    onSuccess: (res) => {
      queryClient.setQueriesData<ArtifactWorkspaceDetail>(
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
