import { type ArtifactHandoffReference, CodingTargetSchema } from '@akasha/protocol'
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
