import { DomainError, NotFoundError } from '../../domain/errors.js'
import { effectiveSharingPolicy, type HubGrant } from '../../domain/hub-sharing.js'
import type { HubIdentityAuthority, HubPrincipal, HubShareClaim } from './authority.js'
import type { HubSharingDependencies } from './dependencies.js'
import { isCurrentGrant } from './grant-state.js'

const roleRank = { view: 0, comment: 1, edit: 2 }

// 只在同一个请求里复用 GitHub 结果；跨请求必须看到退组、离开组织或邮箱移除。
function matchRecipient(auth: HubIdentityAuthority, principal: HubPrincipal) {
  const memberships = new Map<string, string | null>()
  let emails: ReadonlySet<string> | undefined
  return async (grant: HubGrant, accepting: boolean) => {
    const { target, acceptedUserId } = grant
    switch (target.kind) {
      case 'link':
        return false
      case 'member':
      case 'email':
        if (acceptedUserId !== principal.userId && !(accepting && acceptedUserId === null))
          return false
        if (target.kind === 'member')
          return principal.member && grant.subjectId === principal.userId
        if (!emails) {
          const verified = await auth.verifiedEmails(principal).catch(() => [])
          emails = new Set(verified.map((email) => email.toLowerCase()))
        }
        return emails.has(target.email)
      case 'group':
      case 'organization': {
        if (!auth.organization || !grant.subjectId) return false
        const key = target.kind === 'group' ? `group:${target.slug}` : 'organization'
        // 同一 slug 可在被删除后分配给新团队，缓存当前实体键，不能只缓存成员资格。
        if (!memberships.has(key)) {
          const active = await auth.belongsTo(principal, target).catch(() => false)
          const audienceId = active
            ? await auth.resolveAudienceId(principal, target).catch(() => undefined)
            : undefined
          memberships.set(key, audienceId ?? null)
        }
        return memberships.get(key) === grant.subjectId
      }
    }
  }
}

/** 接受链接不是 bearer 授权；只给实际匹配目标的当前浏览器会话合成权限。 */
export function createIdentityGrants({
  repository,
  artifacts,
  auth,
  clock,
}: HubSharingDependencies) {
  const resolveIdentity = async (
    artifactId: string,
    generation: number,
    principal: HubPrincipal,
  ): Promise<HubShareClaim | undefined> => {
    if (principal.kind !== 'session') return
    const candidates = await repository.listGrants(artifactId, generation)
    if (!candidates.length) return
    const matches = matchRecipient(auth, principal)
    const eligible = new Set<string>()
    let externalEmail = false
    const now = Date.parse(clock.now())
    for (const grant of candidates) {
      if (isCurrentGrant(grant, artifactId, generation, now) && (await matches(grant, false))) {
        eligible.add(grant.id)
        if (!principal.member && grant.target.kind === 'email') externalEmail = true
      }
    }
    if (!eligible.size) return
    // 供应商请求进行期间可能已经降权、撤回、撤下或调整外发策略；不得从旧候选行合成权限。
    const [current, active, policy] = await Promise.all([
      repository.listGrants(artifactId, generation),
      artifacts.lifecycle.activeShareGeneration(artifactId),
      externalEmail ? effectiveSharingPolicy(repository, artifactId) : undefined,
    ])
    if (active !== generation) return
    const checkedAt = Date.parse(clock.now())
    let best: HubGrant | undefined
    for (const grant of current) {
      if (!eligible.has(grant.id) || !isCurrentGrant(grant, artifactId, generation, checkedAt))
        continue
      if (grant.target.kind === 'email' && !principal.member && !policy?.externalEmail) continue
      if (
        !best ||
        roleRank[grant.role] > roleRank[best.role] ||
        (grant.role === best.role && grant.expiresAt > best.expiresAt)
      )
        best = grant
    }
    if (!best) return
    return {
      kind: 'share',
      artifactId,
      generation,
      entry: { kind: 'artifact' },
      role: best.role,
      exp: Math.floor(Date.parse(best.expiresAt) / 1000),
      boundUserId: principal.userId,
    }
  }

  const acceptInvite = async (id: string, principal: HubPrincipal) => {
    if (principal.kind !== 'session') throw new DomainError('UNAUTHORIZED', '请先登录 Hub')
    const grant = await repository.getGrant(id)
    const hidden = () => new NotFoundError('未找到请求的资源')
    if (!grant || grant.target.kind === 'link') throw hidden()
    const { artifactId } = grant
    const generation = await artifacts.lifecycle.activeShareGeneration(artifactId)
    if (!isCurrentGrant(grant, artifactId, generation, Date.parse(clock.now()))) throw hidden()
    const matches = matchRecipient(auth, principal)
    if (!(await matches(grant, true))) throw hidden()

    const [current, active, policy] = await Promise.all([
      repository.getGrant(id),
      artifacts.lifecycle.activeShareGeneration(artifactId),
      !principal.member && grant.target.kind === 'email'
        ? effectiveSharingPolicy(repository, artifactId)
        : undefined,
    ])
    if (!isCurrentGrant(current, artifactId, active, Date.parse(clock.now()))) throw hidden()
    if (policy && !policy.externalEmail) throw hidden()
    if (
      (current.target.kind === 'email' || current.target.kind === 'member') &&
      !(await repository.acceptGrant(id, principal.userId))
    )
      throw hidden()
    return { artifactId }
  }

  return { resolveIdentity, acceptInvite }
}
