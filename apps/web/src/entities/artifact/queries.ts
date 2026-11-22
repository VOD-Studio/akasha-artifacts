import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchArtifactDetail,
  fetchArtifacts,
  fetchArtifactVersions,
  revertArtifactVersion,
} from '../../shared/api/client'

export const artifactKeys = {
  all: ['artifacts'] as const,
  list: (projectId?: string) => ['artifacts', 'list', projectId ?? 'all'] as const,
  detail: (id: string, version?: number) => ['artifacts', 'detail', id, version ?? 'head'] as const,
  versions: (id: string) => ['artifacts', 'versions', id] as const,
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
