import { SystemCatalogSchema, type SystemPublicationAction } from '@akasha/protocol'
import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/shared/api/request'

const catalogPath = (projectId: string) =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/system-catalog`

/** 目录以目标项目和当前登录为边界，离开后不保留共享名单的快照。 */
export function catalogOptions(projectId: string) {
  return queryOptions({
    queryKey: ['system-catalog', projectId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) =>
      SystemCatalogSchema.parse(await requestJson<unknown>(catalogPath(projectId), { signal })),
  })
}

/** 操作固定版本；团队默认跨项目，写入后须刷新所有正在使用的目录。 */
export function changePublication(
  projectId: string,
  id: string,
  version: number,
  action: SystemPublicationAction,
) {
  return requestJson<{ ok: true }>(
    `${catalogPath(projectId)}/${encodeURIComponent(id)}/${version}/publication`,
    {
      method: 'PUT',
      body: JSON.stringify({ action }),
    },
  )
}
