import type { Artifact } from '@akasha/protocol'
import { NotFoundError } from '../../domain/errors.js'
import type { HubGrant } from '../../domain/hub-sharing.js'
import type { ArtifactLifecycleRepository, RealtimePublisher } from '../../domain/ports.js'

/** 撤下与不存在都没有活动代数，不能把它们当作初代制品。 */
export async function requireShareGeneration(
  lifecycle: ArtifactLifecycleRepository,
  artifactId: string,
) {
  const generation = await lifecycle.activeShareGeneration(artifactId)
  if (generation === undefined) throw new NotFoundError('未找到请求的资源')
  return generation
}

/** 检查持久化行而非签发时的角色与存活状态；失效行也不进入授权管理列表。 */
export function isCurrentGrant(
  grant: HubGrant | undefined,
  artifactId: string,
  generation: number | undefined,
  now: number,
): grant is HubGrant {
  return (
    !!grant &&
    grant.artifactId === artifactId &&
    grant.generation === generation &&
    Date.parse(grant.expiresAt) > now
  )
}

/** 通知客户端按新权限重读；事件正文不携带制品详情或授权目标。 */
export function notifySharingChanged(realtime: RealtimePublisher, artifact: Artifact) {
  return realtime.publish(
    { type: 'artifact.metadata', artifactId: artifact.publicId },
    { projectId: artifact.projectId },
  )
}
