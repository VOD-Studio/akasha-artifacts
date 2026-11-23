import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchProjects, removeProject } from '../../shared/api/client'

export const projectKeys = {
  all: ['projects'] as const,
}

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

export function useRemoveProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => removeProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
