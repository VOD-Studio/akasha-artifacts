import { PublicIdSchema } from '@akasha/protocol'
import type { ArtifactRepository } from '../../domain/ports.js'
import type { HubArtifactAccess } from './hub-access.js'
import { type HubAuth, sameHubOrigin } from './hub-auth.js'
import { canEditSharedArtifact } from './hub-share-policy.js'

/** 每次投递重查制品与分享范围；空 login 表示可编辑的匿名持有者，而非 Hub 成员。 */
export function createCanvasPresenceAccess(
  auth: Pick<HubAuth, 'authenticateForPresence'>,
  access: Pick<HubArtifactAccess, 'decide'>,
  artifacts: Pick<ArtifactRepository, 'findByPublicId'>,
  origin: string,
) {
  return async (request: Request, artifactId: string) => {
    if (!sameHubOrigin(request, origin) || !PublicIdSchema.safeParse(artifactId).success) return
    const [principal, artifact] = await Promise.all([
      auth.authenticateForPresence(request),
      artifacts.findByPublicId(artifactId),
    ])
    if (!artifact || artifact.type !== 'artboard') return
    const { role, grant } = await access.decide(request, artifact, principal)
    if (grant && !canEditSharedArtifact(grant)) return
    if (!grant && role !== 'owner' && role !== 'editor') return
    const named = !grant || (grant.boundUserId && grant.boundUserId === principal?.userId)
    const login = named ? principal?.login : undefined
    return { login: login && /^[a-z0-9][a-z0-9-]{0,38}$/i.test(login) ? login : null }
  }
}
