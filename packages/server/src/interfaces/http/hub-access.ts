import {
  type Artifact,
  ArtifactIdentifierSchema,
  PublicIdSchema,
  type RealtimeServerEvent,
} from '@akasha/protocol'
import type { ArtifactRepository } from '../../domain/ports.js'
import { type HubPrincipal, sameHubOrigin } from './hub-auth.js'

export interface HubRealtimeScope {
  artifactId?: string
  projectId?: string
}

type HubArtifactRole = 'owner' | 'editor' | 'reader' | 'share' | 'none'
export interface HubAccess {
  authenticate(request: Request): Promise<HubPrincipal | undefined>
  hasShare(request: Request, artifactId: string): Promise<boolean>
}

export interface HubArtifactAccess {
  role(
    request: Request,
    artifact: Artifact,
    principal: HubPrincipal | undefined,
  ): Promise<HubArtifactRole>
  resolve(
    id: string,
    projectId: string | undefined,
    principal: HubPrincipal | undefined,
  ): Promise<Artifact | undefined>
  authorizeArtifact(request: Request, publicId: string, action: 'read' | 'write'): Promise<boolean>
  authorizeRealtime(request: Request, scope: HubRealtimeScope): Promise<boolean>
  authorizeRealtimeEvent(
    request: Request,
    scope: HubRealtimeScope,
    event: RealtimeServerEvent,
  ): Promise<boolean>
}

export function hubProjectPrefix(principal: HubPrincipal): string {
  return `github-${principal.userId}:`
}

export function hubAuthor(principal: HubPrincipal): string {
  return `${principal.kind === 'cli' ? 'agent' : 'human'}:github-${principal.userId}`
}

export function ownsHubProject(principal: HubPrincipal | undefined, projectId: string): boolean {
  return !!principal?.member && projectId.startsWith(hubProjectPrefix(principal))
}

export function baseArtifactRole(
  artifact: Artifact,
  principal: HubPrincipal | undefined,
): Exclude<HubArtifactRole, 'share'> {
  // Hub 只能在当前 GitHub 用户的项目命名空间中创建制品；权限检查无需读取私有版本源码。
  if (ownsHubProject(principal, artifact.projectId)) return 'owner'
  if (principal?.member && artifact.visibility === 'team') return 'editor'
  return artifact.visibility === 'public' ? 'reader' : 'none'
}

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
