import type {
  Artifact,
  HubAdminSharingPolicy,
  HubArtifactSharing,
  HubInviteInput,
} from '@akasha/protocol'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import {
  effectiveSharingPolicy,
  type HubGrant,
  mergeSharingPolicy,
} from '../../domain/hub-sharing.js'
import { createAdminSharingPolicy } from './admin-policy.js'
import type { HubPrincipal, HubShareClaim } from './authority.js'
import type { HubSharingDependencies } from './dependencies.js'
import { isCurrentGrant, notifySharingChanged, requireShareGeneration } from './grant-state.js'
import { createIdentityGrants } from './identity-grants.js'

/** Hub 容器在访问守卫与管理路由间共享的应用服务。 */
export interface HubSharing {
  list(artifact: Artifact): Promise<HubArtifactSharing>
  invite(
    artifact: Artifact,
    owner: HubPrincipal,
    input: HubInviteInput,
  ): Promise<{ id: string; url: string; expiresAt: string }>
  onlyMe(artifact: Artifact): Promise<void>
  changeRole(artifact: Artifact, id: string, role: HubGrant['role']): Promise<void>
  revoke(artifact: Artifact, id: string): Promise<void>
  acceptInvite(id: string, principal: HubPrincipal): Promise<{ artifactId: string }>
  resolveIdentity(
    artifactId: string,
    generation: number,
    principal: HubPrincipal,
  ): Promise<HubShareClaim | undefined>
  readPolicy(artifactId: string): Promise<HubAdminSharingPolicy>
  updatePolicy(
    artifact: Artifact,
    update: Pick<HubAdminSharingPolicy, 'defaults'> | Pick<HubAdminSharingPolicy, 'override'>,
  ): Promise<HubAdminSharingPolicy>
}

/** 管理入口只接收路由已核实所有权的活动制品；定向授权和持有者链接共用一份清单。 */
export function createHubSharing(deps: HubSharingDependencies): HubSharing {
  const { repository, artifacts, auth, clock, origin, realtime } = deps
  const list = async (artifact: Artifact): Promise<HubArtifactSharing> => {
    const id = artifact.publicId
    const generation = await requireShareGeneration(artifacts.lifecycle, id)
    const [defaults, scope, grants] = await Promise.all([
      repository.getDefaults(),
      repository.getScope(id),
      repository.listGrants(id, generation),
    ])
    const now = Date.parse(clock.now())
    return {
      restricted: scope.restricted,
      organization: auth.organization ?? null,
      policy: mergeSharingPolicy(defaults, scope.override),
      grants: grants
        .filter((grant) => isCurrentGrant(grant, id, generation, now))
        .map((grant) => ({
          id: grant.id,
          target: grant.target,
          role: grant.role,
          expiresAt: grant.expiresAt,
          accepted: grant.acceptedUserId !== null,
        })),
    }
  }

  const invite = async (artifact: Artifact, owner: HubPrincipal, input: HubInviteInput) => {
    const artifactId = artifact.publicId
    const generation = await requireShareGeneration(artifacts.lifecycle, artifactId)
    let target = input.target
    let subjectId: string | null = null
    switch (target.kind) {
      case 'member': {
        const member = await auth.lookupMember(owner, target.login).catch(() => undefined)
        if (!member) throw new NotFoundError('未找到可邀请的 Hub 成员')
        target = { kind: 'member', login: member.login }
        subjectId = member.userId
        break
      }
      case 'email': {
        const policy = await effectiveSharingPolicy(repository, artifactId)
        if (!policy.externalEmail && !(await auth.isInternalEmail(target.email).catch(() => false)))
          throw new DomainError('FORBIDDEN', '当前策略仅允许邀请 Hub 成员的已验证邮箱')
        break
      }
      case 'organization':
      case 'group': {
        const audienceId = await auth.resolveAudienceId(owner, target).catch(() => undefined)
        if (!audienceId) throw new NotFoundError('未找到可邀请的 GitHub 组织或团队')
        subjectId = audienceId
        break
      }
    }
    if (generation !== (await artifacts.lifecycle.activeShareGeneration(artifactId)))
      throw new NotFoundError('未找到请求的资源')
    const id = crypto.randomUUID()
    const expires = Math.floor(Date.parse(clock.now()) / 1000) + input.ttlSeconds
    const expiresAt = new Date(expires * 1000).toISOString()
    await repository.createGrant({
      id,
      artifactId,
      generation,
      target,
      role: input.role,
      expiresAt,
      subjectId,
      acceptedUserId: null,
      entry: { kind: 'artifact' },
    })
    await notifySharingChanged(realtime, artifact)
    return { id, url: new URL(`/invite/${id}`, origin).href, expiresAt }
  }

  const onlyMe = async (artifact: Artifact) => {
    await requireShareGeneration(artifacts.lifecycle, artifact.publicId)
    await repository.restrictToOwner(artifact.publicId)
    await notifySharingChanged(realtime, artifact)
  }

  const requireGrant = async (artifact: Artifact, id: string) => {
    const [generation, grant] = await Promise.all([
      artifacts.lifecycle.activeShareGeneration(artifact.publicId),
      repository.getGrant(id),
    ])
    if (!isCurrentGrant(grant, artifact.publicId, generation, Date.parse(clock.now())))
      throw new NotFoundError('未找到请求的资源')
  }

  const changeRole = async (artifact: Artifact, id: string, role: HubGrant['role']) => {
    await requireGrant(artifact, id)
    if (!(await repository.changeRole(artifact.publicId, id, role)))
      throw new NotFoundError('未找到请求的资源')
    await notifySharingChanged(realtime, artifact)
  }

  const revoke = async (artifact: Artifact, id: string) => {
    await requireGrant(artifact, id)
    if (!(await repository.revokeGrant(artifact.publicId, id)))
      throw new NotFoundError('未找到请求的资源')
    await notifySharingChanged(realtime, artifact)
  }

  return {
    list,
    invite,
    onlyMe,
    changeRole,
    revoke,
    ...createIdentityGrants(deps),
    ...createAdminSharingPolicy(deps),
  }
}
