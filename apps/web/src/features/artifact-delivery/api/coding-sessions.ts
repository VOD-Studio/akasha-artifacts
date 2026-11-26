import {
  type ArtifactHandoffReference,
  CodingSessionPublicationSchema,
  CodingTargetSchema,
  CodingWorkspaceSchema,
} from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/** 列表包含仍有心跳的空闲端，以及已绑定到同一快照和选区的会话。 */
export async function listCodingTargets(reference: ArtifactHandoffReference, signal: AbortSignal) {
  return CodingTargetSchema.array().parse(
    await requestJson(
      `/api/v1/projects/${encodeURIComponent(reference.projectId)}/coding-sessions/targets`,
      { method: 'POST', body: JSON.stringify(reference), signal },
    ),
  )
}

/** 只能绑定一次；凭会话 ID 本身不能读取或发布设计。 */
export async function bindCodingTarget(reference: ArtifactHandoffReference, id: string) {
  const result = CodingTargetSchema.parse(
    await requestJson(
      `/api/v1/projects/${encodeURIComponent(reference.projectId)}/coding-sessions/${encodeURIComponent(id)}/bind`,
      { method: 'POST', body: JSON.stringify(reference) },
    ),
  )
  if (result.id !== id || !result.bound) throw new Error('绑定回执与所选会话不一致')
  return result
}

/** 服务器按浏览器作者身份验证项目；路径不含终端凭据。 */
export async function readCodingWorkspace(project: string, id: string, signal: AbortSignal) {
  const workspace = CodingWorkspaceSchema.parse(
    await requestJson(
      `/api/v1/projects/${encodeURIComponent(project)}/coding-sessions/${encodeURIComponent(id)}/workspace`,
      { method: 'POST', signal },
    ),
  )
  if (workspace.target.id !== id || workspace.snapshot.reference.projectId !== project)
    throw new Error('工作区与所选会话不一致')
  return workspace
}

/** 浏览器与工程端共用同一冻结基线；发生冲突时保留调用方的编辑内容。 */
export async function publishCodingWorkspace(project: string, id: string, source: string) {
  return CodingSessionPublicationSchema.parse(
    await requestJson(
      `/api/v1/projects/${encodeURIComponent(project)}/coding-sessions/${encodeURIComponent(id)}/workspace-publish`,
      { method: 'POST', body: JSON.stringify({ source }) },
    ),
  )
}
