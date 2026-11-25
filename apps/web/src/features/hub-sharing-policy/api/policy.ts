import type { HubAdminSharingPolicy, HubSharingOverride, HubSharingPolicy } from '@akasha/protocol'
import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/shared/api/request'

const adminSharingUrl = (artifactId: string) =>
  `/api/v1/admin/sharing/${encodeURIComponent(artifactId)}`

/** 管理员会话即可读取；返回值不含作品内容，读取失败不得当作空策略。 */
export function adminSharingOptions(artifactId: string) {
  return queryOptions({
    queryKey: ['hub-admin-sharing', artifactId],
    queryFn: () =>
      requestJson<HubAdminSharingPolicy>(adminSharingUrl(artifactId), undefined, 'workbench'),
  })
}

/** 提交 Hub 默认值；作品例外由服务端保持当前值，响应为提交后的完整策略。 */
export function putAdminSharingDefaults(
  artifactId: string,
  defaults: HubSharingPolicy,
): Promise<HubAdminSharingPolicy> {
  return requestJson(
    adminSharingUrl(artifactId),
    { method: 'PUT', body: JSON.stringify({ defaults }) },
    'workbench',
  )
}

/** 提交单作品例外；Hub 默认值由服务端保持当前值，响应为提交后的完整策略。 */
export function putAdminSharingOverride(
  artifactId: string,
  override: HubSharingOverride,
): Promise<HubAdminSharingPolicy> {
  return requestJson(
    adminSharingUrl(artifactId),
    { method: 'PUT', body: JSON.stringify({ override }) },
    'workbench',
  )
}
