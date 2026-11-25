import type { ArtifactShareInput } from '@akasha/protocol'
import type { HubShareClaim } from '../../../application/hub-sharing/authority.js'
import { effectiveSharingPolicy, type HubSharingRepository } from '../../../domain/hub-sharing.js'
import type { ArtifactLifecycleRepository } from '../../../domain/ports.js'

/** 签名固定制品、代数、范围和到期时间；角色从服务器上的链接授权实时读取。 */
export function createSignedLinks(
  sharing: HubSharingRepository,
  lifecycle: ArtifactLifecycleRepository,
  now: () => number,
) {
  const issue = async (artifactId: string, { ttlSeconds, role, entry }: ArtifactShareInput) => {
    const [policy, generation] = await Promise.all([
      effectiveSharingPolicy(sharing, artifactId),
      lifecycle.activeShareGeneration(artifactId),
    ])
    if (!policy.externalLinks || generation === undefined) return
    const exp = now() + ttlSeconds
    const id = crypto.randomUUID()
    await sharing.createGrant({
      id,
      artifactId,
      role,
      entry,
      expiresAt: new Date(exp * 1000).toISOString(),
      generation,
      target: { kind: 'link' },
      subjectId: null,
      acceptedUserId: null,
    })
    return { kind: 'share' as const, artifactId, role, entry, exp, generation, grantId: id }
  }
  const resolve = async (
    claim: HubShareClaim,
    mode?: 'revocation',
  ): Promise<HubShareClaim | undefined> => {
    const { artifactId, grantId } = claim
    const policy = await effectiveSharingPolicy(sharing, artifactId)
    if (!policy.externalLinks) return
    if (mode === 'revocation') {
      // 已订阅连接的空刷新没有正文；撤下制品没有活动代数，不能用此分支读内容或建立订阅。
      if (!(await lifecycle.findWithdrawn(artifactId))) return
    } else if ((await lifecycle.activeShareGeneration(artifactId)) !== claim.generation) {
      return
    }
    if (grantId === undefined) {
      // 旧链接没有独立授权记录；收紧过可见性的制品不可再继承这些签名。
      return (await sharing.getScope(artifactId)).restricted ? undefined : claim
    }
    const grant = await sharing.getGrant(grantId)
    if (
      grant?.target.kind !== 'link' ||
      grant.artifactId !== artifactId ||
      grant.generation !== claim.generation ||
      !(Date.parse(grant.expiresAt) > now() * 1000)
    )
      return
    return { ...claim, role: grant.role }
  }
  return { issue, resolve }
}
