import type { ArtifactType, Project } from '@akasha/protocol'
import { useMemo } from 'react'
import { useArtifactFavoritesQuery, useArtifactsQuery } from '@/entities/artifact'
import { useProjectsQuery } from '@/entities/project'
import { useWorkspaceStore } from '@/entities/workspace'
import type { Locale } from '@/shared/i18n'
import { useLibraryView } from '../model/library-view'

const LIBRARY_REFRESH_MS = 10_000

/** 从库的筛选偏好派生当前可见作品；保留查询错误供外壳重试。 */
export function useLibraryResults(locale: Locale) {
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const setSelectedProjectId = useWorkspaceStore((state) => state.setSelectedProjectId)
  const search = useLibraryView((state) => state.search)
  const type = useLibraryView((state) => state.type)
  const favoritesOnly = useLibraryView((state) => state.favoritesOnly)
  const order = useLibraryView((state) => state.order)
  const projectsQuery = useProjectsQuery(LIBRARY_REFRESH_MS)
  const artifactsQuery = useArtifactsQuery(undefined, LIBRARY_REFRESH_MS)
  const favoritesQuery = useArtifactFavoritesQuery()
  const favorites = useMemo(
    () => (favoritesQuery.isSuccess ? new Set(favoritesQuery.data) : null),
    [favoritesQuery.isSuccess, favoritesQuery.data],
  )
  const projects = projectsQuery.isSuccess ? projectsQuery.data : undefined
  const artifacts = artifactsQuery.data
  const isLoading = projectsQuery.isLoading || artifactsQuery.isLoading
  const failure = artifactsQuery.error ?? projectsQuery.error

  const projectMap = useMemo(() => {
    const map = new Map<string, Project>()
    for (const project of projects ?? []) map.set(project.id, project)
    return map
  }, [projects])
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase(locale)
    const list = (artifacts ?? []).filter((artifact) => {
      if (favoritesOnly && favorites && !favorites.has(artifact.publicId)) return false
      if (selectedProjectId && artifact.projectId !== selectedProjectId) return false
      if (type !== 'all' && artifact.type !== type) return false
      return (
        !keyword ||
        artifact.title.toLocaleLowerCase(locale).includes(keyword) ||
        artifact.slug.toLocaleLowerCase(locale).includes(keyword) ||
        artifact.publicId.toLocaleLowerCase(locale).includes(keyword) ||
        projectMap.get(artifact.projectId)?.name.toLocaleLowerCase(locale).includes(keyword)
      )
    })
    return list.sort(
      order === 'title'
        ? (a, b) => a.title.localeCompare(b.title, locale)
        : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
  }, [
    artifacts,
    favorites,
    favoritesOnly,
    locale,
    order,
    projectMap,
    search,
    selectedProjectId,
    type,
  ])
  const presentTypes = useMemo(() => {
    const values = new Set<ArtifactType>()
    for (const artifact of artifacts ?? []) values.add(artifact.type)
    return Array.from(values)
  }, [artifacts])

  const resetFilters = () => {
    setSelectedProjectId(null)
    useLibraryView.setState({ search: '', type: 'all', favoritesOnly: false })
  }
  const retryLibrary = () => {
    if (artifactsQuery.isError) void artifactsQuery.refetch()
    if (projectsQuery.isError) void projectsQuery.refetch()
  }

  return {
    projects,
    projectMap,
    hasArtifacts: Boolean(artifacts?.length),
    visible,
    presentTypes,
    favorites,
    isLoading,
    failure,
    resetFilters,
    retryLibrary,
  }
}
