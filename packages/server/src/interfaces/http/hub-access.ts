import {
  type Artifact,
  ArtifactIdentifierSchema,
  PublicIdSchema,
  type RealtimeServerEvent,
} from '@akasha/protocol'
import type { ArtifactRepository } from '../../domain/ports.js'
import { type HubPrincipal, sameHubOrigin } from './hub-auth.js'

/** 实时订阅或单条事件的授权范围：项目、制品，或两者。 */
export interface HubRealtimeScope {
  artifactId?: string
  projectId?: string
}

// 角色由高到低：owner 项目所有者，editor 团队协作者，share 持分享链接者，reader 只读
type HubArtifactRole = 'owner' | 'editor' | 'reader' | 'share' | 'none'
export interface HubAccess {
  /** 凭 cookie 或 Bearer 解析调用方；无法识别时返回 `undefined`。 */
  authenticate(request: Request): Promise<HubPrincipal | undefined>
  /** 请求是否持有某制品的有效分享链接。 */
  hasShare(request: Request, artifactId: string): Promise<boolean>
}

export interface HubArtifactAccess {
  /** 综合可见性与分享链接，得出调用方对某制品的角色。 */
  role(
    request: Request,
    artifact: Artifact,
    principal: HubPrincipal | undefined,
  ): Promise<HubArtifactRole>
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

/**
 * 不考虑分享链接时的角色：项目所有者为 `owner`，成员对 `team` 制品为 `editor`，
 * `public` 制品对任何人为 `reader`，其余为 `none`。
 */
export function baseArtifactRole(
  artifact: Artifact,
  principal: HubPrincipal | undefined,
): Exclude<HubArtifactRole, 'share'> {
  // Hub 只能在当前 GitHub 用户的项目命名空间中创建制品；权限检查无需读取私有版本源码。
  if (ownsHubProject(principal, artifact.projectId)) return 'owner'
  if (principal?.member && artifact.visibility === 'team') return 'editor'
  return artifact.visibility === 'public' ? 'reader' : 'none'
}

/** 组装 Hub 的制品访问控制；`origin` 用于同源校验。 */
export function createHubAccess(
  artifacts: ArtifactRepository,
  auth: HubAccess,
  origin: string,
): HubArtifactAccess {
  async function role(
    request: Request,
    artifact: Artifact,
    principal: HubPrincipal | undefined,
  ): Promise<HubArtifactRole> {
    const access = baseArtifactRole(artifact, principal)
    if (
      access !== 'owner' &&
      access !== 'editor' &&
      (await auth.hasShare(request, artifact.publicId))
    ) {
      return 'share'
    }
    return access
  }

  async function resolve(
    id: string,
    projectId: string | undefined,
    principal: HubPrincipal | undefined,
  ): Promise<Artifact | undefined> {
    if (!ArtifactIdentifierSchema.safeParse(id).success) return
    if (PublicIdSchema.safeParse(id).success) {
      const artifact = await artifacts.findByPublicId(id)
      if (artifact) return projectId && artifact.projectId !== projectId ? undefined : artifact
    }
    const project =
      projectId ?? (principal?.member ? `${hubProjectPrefix(principal)}default` : undefined)
    return project && principal?.member ? artifacts.findBySlug(project, id) : undefined
  }

  async function authorizeArtifact(
    request: Request,
    publicId: string,
    action: 'read' | 'write',
  ): Promise<boolean> {
    if (!sameHubOrigin(request, origin) || !PublicIdSchema.safeParse(publicId).success) return false
    const principal = await auth.authenticate(request)
    if (action === 'write' && !principal?.member) return false
    const artifact = await artifacts.findByPublicId(publicId)
    if (!artifact) return false
    if (action === 'read') return (await role(request, artifact, principal)) !== 'none'
    const access = baseArtifactRole(artifact, principal)
    return access === 'owner' || access === 'editor'
  }

  async function authorizeRealtime(request: Request, scope: HubRealtimeScope): Promise<boolean> {
    if (!sameHubOrigin(request, origin) || scope.projectId === '') return false
    const principal = await auth.authenticate(request)
    if (scope.artifactId !== undefined) {
      if (!PublicIdSchema.safeParse(scope.artifactId).success) return false
      const artifact = await artifacts.findByPublicId(scope.artifactId)
      if (!artifact || (scope.projectId && artifact.projectId !== scope.projectId)) return false
      return (await role(request, artifact, principal)) !== 'none'
    }
    if (!scope.projectId || !principal?.member) return false
    if (ownsHubProject(principal, scope.projectId)) return true
    return (await artifacts.listByProject(scope.projectId)).some(
      (artifact) => artifact.visibility !== 'private',
    )
  }

  async function authorizeRealtimeEvent(
    request: Request,
    scope: HubRealtimeScope,
    event: RealtimeServerEvent,
  ): Promise<boolean> {
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
        !artifact ||
        (scope.projectId && artifact.projectId !== scope.projectId) ||
        (!scope.artifactId && !principal?.member)
      )
        return false
      const access = scope.artifactId
        ? await role(request, artifact, principal)
        : baseArtifactRole(artifact, principal)
      if (
        (event.type === 'feedback.created' || event.type === 'feedback.updated') &&
        event.feedback.draft
      ) {
        return access === 'owner' || access === 'editor'
      }
      return access !== 'none'
    }
    return (
      event.type === 'agent.activity' &&
      !!scope.projectId &&
      ownsHubProject(principal, event.projectId)
    )
  }

  return {
    role,
    resolve,
    authorizeArtifact,
    authorizeRealtime,
    authorizeRealtimeEvent,
  }
}
