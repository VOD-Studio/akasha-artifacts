import {
  type CatalogGenerateInput,
  CatalogGenerateOutputSchema,
  SystemCatalogSchema,
  type SystemPublicationAction,
} from '@akasha/protocol'
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

/** 持久化本人偏好，不改团队默认版本，也不提交本次设计。 */
export function updateDefaultPreference(projectId: string, inheritDefault: boolean) {
  return requestJson<{ ok: true }>(`${catalogPath(projectId)}/preference`, {
    method: 'PUT',
    body: JSON.stringify({ inheritDefault }),
  })
}

/** 省略 selections 才继承个人偏好；显式空数组仅对本次起稿生效。 */
export async function generateCatalogDesign(projectId: string, input: CatalogGenerateInput) {
  return CatalogGenerateOutputSchema.parse(
    await requestJson<unknown>(`${catalogPath(projectId)}/generate`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}
