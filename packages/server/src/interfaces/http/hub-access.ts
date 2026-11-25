import {
  type Artifact,
  ArtifactIdentifierSchema,
  PublicIdSchema,
  type RealtimeServerEvent,
} from '@akasha/protocol'
import type { HubSharing } from '../../application/hub-sharing/service.js'
import type { HubSharingRepository, HubSharingScope } from '../../domain/hub-sharing.js'
import type { ArtifactRepository } from '../../domain/ports.js'
import {
  fixedShareVersion,
  type HubAuth,
  type HubPrincipal,
  type HubShareClaim,
  sameHubOrigin,
} from './hub-auth.js'

/** 实时订阅或单条事件的授权范围：项目、制品，或两者。 */
export interface HubRealtimeScope {
  artifactId?: string
  projectId?: string
}

type DirectRole = 'owner' | 'editor' | 'reader' | 'none'
type ArtifactAccess =
  | { role: DirectRole; grant?: undefined }
  | { role: 'share'; grant: HubShareClaim }

export interface HubArtifactAccess {
  /** 同一次裁决返回角色和实际授权依据，不能在调用方另按旧可见性补权。 */
  decide(request: Request, artifact: Artifact, principal?: HubPrincipal): Promise<ArtifactAccess>
  /** 作品库以账号资格列出；持有者链接及固定版不会让制品出现在库中。 */
  listVisible(artifacts: readonly Artifact[], principal?: HubPrincipal): Promise<Artifact[]>
  /** 把路径里的标识解析为调用方可见的制品；不可见时返回 `undefined`。 */
  resolve(
    id: string,
    projectId: string | undefined,
    principal: HubPrincipal | undefined,
  ): Promise<Artifact | undefined>
  /** 同源校验之后，判断调用方对某制品能否读或写。 */
  authorizeArtifact(request: Request, publicId: string, action: 'read' | 'write'): Promise<boolean>
  /** 判断调用方能否订阅给定范围。 */
  authorizeRealtime(request: Request, scope: HubRealtimeScope): Promise<boolean>
  /** 逐条判断某范围内的事件能否下发给该连接；草稿反馈只给 `owner` 与 `editor`。 */
  authorizeRealtimeEvent(
    request: Request,
    scope: HubRealtimeScope,
    event: RealtimeServerEvent,
  ): Promise<boolean>
}

/** Hub 上项目 id 的命名空间前缀，形如 `github-<userId>:`。 */
export function hubProjectPrefix(principal: HubPrincipal): string {
  return `github-${principal.userId}:`
}

/** 把调用方转成反馈作者：CLI 令牌为 `agent:`，浏览器会话为 `human:`。 */
export function hubAuthor(principal: HubPrincipal): string {
  return `${principal.kind === 'cli' ? 'agent' : 'human'}:github-${principal.userId}`
}

/** 项目是否落在调用方自己的命名空间内；非成员一律为 false。 */
export function ownsHubProject(principal: HubPrincipal | undefined, projectId: string): boolean {
  return !!principal?.member && projectId.startsWith(hubProjectPrefix(principal))
}

/** 旧可见性只在未切换到定向授权的制品上生效。 */
function visibilityRole(
  artifact: Artifact,
  principal: HubPrincipal | undefined,
  externalLinks: boolean,
): DirectRole {
  if (principal?.member && artifact.visibility === 'team') return 'editor'
  return artifact.visibility === 'public' && (principal?.member || externalLinks)
    ? 'reader'
    : 'none'
}

const roleLevel = { view: 0, comment: 1, edit: 2 }

/** 组装 Hub 的制品访问控制；`origin` 用于同源校验。 */
export function createHubAccess(
  artifacts: ArtifactRepository,
  auth: Pick<HubAuth, 'authenticate' | 'readShare'>,
  origin: string,
  repository: HubSharingRepository,
  sharing: Pick<HubSharing, 'resolveIdentity'>,
): HubArtifactAccess {
  const identityGrant = async (artifact: Artifact, principal?: HubPrincipal) => {
    if (principal?.kind !== 'session') return
    const generation = await artifacts.lifecycle.activeShareGeneration(artifact.publicId)
    if (generation !== undefined)
      return sharing.resolveIdentity(artifact.publicId, generation, principal)
  }

  const directRole = async (
    artifact: Artifact,
    principal: HubPrincipal | undefined,
    { restricted, override }: HubSharingScope,
  ): Promise<DirectRole> => {
    if (restricted) return 'none'
    const needsExternal = artifact.visibility === 'public' && !principal?.member
    const externalLinks =
      needsExternal && (override.externalLinks ?? (await repository.getDefaults()).externalLinks)
    return visibilityRole(artifact, principal, externalLinks)
  }

  const decide = async (
    request: Request,
    artifact: Artifact,
    principal?: HubPrincipal,
    includeLink = true,
  ): Promise<ArtifactAccess> => {
    if (ownsHubProject(principal, artifact.projectId)) return { role: 'owner' }
    const scope = await repository.getScope(artifact.publicId)
    const base = await directRole(artifact, principal, scope)
    if (base === 'editor') return { role: base }
    const [identity, link] = await Promise.all([
      scope.restricted ? identityGrant(artifact, principal) : undefined,
      includeLink ? auth.readShare(request, artifact.publicId) : undefined,
    ])
    // 固定快照不能放宽或收窄已有的制品级身份授权；非固定链接则可独立授予更高角色。
    const grant =
      link &&
      (!identity ||
        (link.entry.kind === 'artifact' && roleLevel[link.role] > roleLevel[identity.role]))
        ? link
        : identity
    return grant ? { role: 'share', grant } : { role: base }
  }

  const listVisible = async (items: readonly Artifact[], principal?: HubPrincipal) => {
    const [scopes, defaults] = await Promise.all([
      repository.getScopes(items.map(({ publicId }) => publicId)),
      principal?.member ? undefined : repository.getDefaults(),
    ])
    const visible = await Promise.all(
      items.map((item) => {
        if (ownsHubProject(principal, item.projectId)) return true
        const scope = scopes.get(item.publicId)
        return scope?.restricted
          ? identityGrant(item, principal)
          : visibilityRole(
              item,
              principal,
              scope?.override.externalLinks ?? defaults?.externalLinks ?? false,
            ) !== 'none'
      }),
    )
    return items.filter((_, index) => visible[index])
  }

  const resolve = async (
    id: string,
    projectId: string | undefined,
    principal: HubPrincipal | undefined,
  ): Promise<Artifact | undefined> => {
    if (!ArtifactIdentifierSchema.safeParse(id).success) return
    if (PublicIdSchema.safeParse(id).success) {
      const artifact = await artifacts.findByPublicId(id)
      if (artifact) return projectId && artifact.projectId !== projectId ? undefined : artifact
      if (await artifacts.lifecycle.findWithdrawn(id)) return
    }
    const project =
      projectId ?? (principal?.member ? `${hubProjectPrefix(principal)}default` : undefined)
    return project && principal?.member ? artifacts.findBySlug(project, id) : undefined
  }

  const authorizeArtifact = async (
    request: Request,
    publicId: string,
    action: 'read' | 'write',
  ): Promise<boolean> => {
    if (!sameHubOrigin(request, origin) || !PublicIdSchema.safeParse(publicId).success) return false
    const principal = await auth.authenticate(request)
    if (action === 'write' && !principal?.member) return false
    const artifact = await artifacts.findByPublicId(publicId)
    if (!artifact) return false
    const { role } = await decide(request, artifact, principal)
    // 此处的 write 是内部团队写权限，不包含只能改设计稿的受限 edit 授权。
    return action === 'read' ? role !== 'none' : role === 'owner' || role === 'editor'
  }

  const authorizeRealtime = async (request: Request, scope: HubRealtimeScope): Promise<boolean> => {
    if (!sameHubOrigin(request, origin) || scope.projectId === '') return false
    const principal = await auth.authenticate(request)
    if (scope.artifactId !== undefined) {
      if (!PublicIdSchema.safeParse(scope.artifactId).success) return false
      const artifact = await artifacts.findByPublicId(scope.artifactId)
      if (!artifact || (scope.projectId && artifact.projectId !== scope.projectId)) return false
      return (await decide(request, artifact, principal)).role !== 'none'
    }
    if (!scope.projectId || !principal?.member) return false
    if (ownsHubProject(principal, scope.projectId)) return true
    const items = await artifacts.listByProject(scope.projectId)
    const scopes = await repository.getScopes(items.map(({ publicId }) => publicId))
    return items.some(
      (item) =>
        !scopes.get(item.publicId)?.restricted && visibilityRole(item, principal, false) !== 'none',
    )
  }

  const authorizeRealtimeEvent = async (
    request: Request,
    scope: HubRealtimeScope,
    event: RealtimeServerEvent,
  ): Promise<boolean> => {
    if (
      !sameHubOrigin(request, origin) ||
      (!scope.artifactId && !scope.projectId) ||
      scope.projectId === '' ||
      scope.artifactId === ''
    )
      return false
    if (event.type === 'resync' && !event.artifactId) return authorizeRealtime(request, scope)
    if (scope.artifactId && event.artifactId !== scope.artifactId) return false
    if (event.type === 'agent.activity' && scope.projectId && event.projectId !== scope.projectId)
      return false
    const principal = await auth.authenticate(request)
    if (event.artifactId) {
      const artifact = await artifacts.findByPublicId(event.artifactId)
      if (
        !artifact &&
        event.type === 'artifact.metadata' &&
        scope.artifactId === event.artifactId
      ) {
        const withdrawn = await artifacts.lifecycle.findWithdrawn(event.artifactId)
        if (!withdrawn) return false
        if (ownsHubProject(principal, withdrawn.artifact.projectId)) return true
        const direct = await directRole(
          withdrawn.artifact,
          principal,
          await repository.getScope(event.artifactId),
        )
        return Boolean(
          direct !== 'none' || (await auth.readShare(request, event.artifactId, 'revocation')),
        )
      }
      if (
        !artifact ||
        (scope.projectId &&
          artifact.projectId !== scope.projectId &&
          !(scope.artifactId && event.type === 'artifact.metadata')) ||
        (!scope.artifactId && !principal?.member)
      )
        return false
      const { grant, role } = await decide(request, artifact, principal, Boolean(scope.artifactId))
      if (grant) {
        // 定向授权和链接都不是项目订阅资格。
        if (!scope.artifactId) return false
        // 讨论变更只通知重读，再由 HTTP 按版本过滤；不转发正文、轮次、状态和 Agent 活动。
        if (
          event.type === 'annotation.changed' ||
          event.type === 'artifact.metadata' ||
          event.type === 'resync'
        )
          return true
        return (
          event.type === 'version.created' &&
          (fixedShareVersion(grant) === undefined ||
            event.version.version === fixedShareVersion(grant))
        )
      }
      if (role === 'none') return false
      if (
        (event.type === 'feedback.created' || event.type === 'feedback.updated') &&
        event.feedback.draft
      ) {
        return role === 'owner' || role === 'editor'
      }
      return true
    }
    return (
      event.type === 'agent.activity' &&
      !!scope.projectId &&
      ownsHubProject(principal, event.projectId)
    )
  }

  return {
    decide,
    listVisible,
    resolve,
    authorizeArtifact,
    authorizeRealtime,
    authorizeRealtimeEvent,
  }
}
