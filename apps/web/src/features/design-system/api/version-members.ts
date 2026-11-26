import { SystemMembersSchema } from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

function membersPath(projectId: string, id: string, version: number) {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/system-catalog/${encodeURIComponent(id)}/${version}/members`
}

/** 名单只针对固定版本，不表示来源项目或制品的读取权。 */
export async function loadVersionMembers(projectId: string, id: string, version: number, signal: AbortSignal) {
  return SystemMembersSchema.parse(await requestJson<unknown>(membersPath(projectId, id, version), { signal }))
}

/** 全量替换；空名单撤回此版本的所有点名授权。 */
export async function replaceVersionMembers(projectId: string, id: string, version: number, logins: string[]) {
  return SystemMembersSchema.parse(await requestJson<unknown>(membersPath(projectId, id, version), {
    method: 'PUT',
    body: JSON.stringify({ logins }),
  }))
}
