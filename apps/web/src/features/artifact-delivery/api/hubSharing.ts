import type { ArtifactShareInput, HubArtifactSharing, HubInviteInput } from '@akasha/protocol'
import type { QueryClient } from '@tanstack/react-query'
import { artifactKeys } from '@/entities/artifact'
import { requestJson } from '@/shared/api/request'

/** 分享角色：仅查看、可批注或可编辑最新版本。 */
export type HubShareRole = ArtifactShareInput['role']

/** 同一作品的写操作共用 mutation key；即使表单已卸载，也等授权清单刷新后再接受下一次操作。 */
export function hubSharingMutationOptions(client: QueryClient, artifactId: string) {
  const mutationKey = artifactKeys.sharing(artifactId)
  return {
    mutationKey,
    onSettled: () => client.invalidateQueries({ queryKey: mutationKey }),
  }
}

/** 新建邀请的回执；`url` 是可直接外发的 `/invite/<id>` 绝对地址。 */
export interface HubInvitation {
  id: string
  url: string
  expiresAt: string
}

/** 读取所有者视角的分享设置与当前授权；非所有者会话得到 403，未登录得到 401。 */
export async function fetchHubArtifactSharing(artifactId: string): Promise<HubArtifactSharing> {
  return requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/sharing`,
    undefined,
    'workbench',
  )
}

/** 移除全部授权并停止沿用原有团队或公开可见性；历史匿名链接不能重新启用。 */
export async function restrictHubSharingToOwner(artifactId: string): Promise<void> {
  await requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/sharing/only-me`,
    { method: 'POST' },
    'workbench',
  )
}

/** 创建一条定向邀请；成员与邮箱须被本人接受，组织与团队按当前成员资格直接生效。 */
export async function createHubInvitation(
  artifactId: string,
  input: HubInviteInput,
): Promise<HubInvitation> {
  return requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/invitations`,
    { method: 'POST', body: JSON.stringify(input) },
    'workbench',
  )
}

/** 调整一条授权的角色；对已发出的签名与邀请地址立即按新角色生效。 */
export async function changeHubGrantRole(
  artifactId: string,
  grantId: string,
  role: HubShareRole,
): Promise<void> {
  await requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/sharing/grants/${encodeURIComponent(
      grantId,
    )}`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
    'workbench',
  )
}

/** 撤回一条授权；对应的邀请地址与已发签名立即失效。 */
export async function revokeHubGrant(artifactId: string, grantId: string): Promise<void> {
  await requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/sharing/grants/${encodeURIComponent(
      grantId,
    )}`,
    { method: 'DELETE' },
    'workbench',
  )
}
