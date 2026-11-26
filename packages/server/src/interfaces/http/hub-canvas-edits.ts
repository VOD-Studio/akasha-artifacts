import { PublicIdSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../application/artifact-service.js'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import { type HubArtifactAccess, hubAuthor } from './hub-access.js'
import type { HubAuth } from './hub-auth.js'
import { canEditSharedArtifact } from './hub-share-policy.js'
import { sharedAuthor } from './hub-sharing/shared-artifact.js'
import { parseJsonBody } from './request-body.js'

const canvasEdit = z.object({ baseVersion: z.number().int().positive(), source: z.string() })

interface HubCanvasEdits {
  service: Pick<ArtifactService, 'editCanvas'>
  access: Pick<HubArtifactAccess, 'decide'>
  auth: Pick<HubAuth, 'authenticate'>
}

/** 只装配在 Hub 同源守卫后；访客按链接署名，CLI 与固定快照都不能发起共同编辑。 */
export function mountHubCanvasEdits(core: Hono, { service, access, auth }: HubCanvasEdits) {
  core.post('/api/v1/artifacts/:id/canvas-edits', async (c) => {
    const id = PublicIdSchema.safeParse(c.req.param('id'))
    if (!id.success || c.req.query('version') !== undefined)
      throw new NotFoundError('未找到请求的资源')
    const request = c.req.raw
    const { baseVersion, source } = await parseJsonBody(request, canvasEdit)
    const result = await service.editCanvas({
      publicId: id.data,
      baseVersion,
      source,
      authorize: async (artifact) => {
        const principal = await auth.authenticate(request)
        const { role, grant } = await access.decide(request, artifact, principal)
        if (role === 'none') throw new NotFoundError('未找到请求的资源')
        if (principal?.kind !== 'cli') {
          if (grant && canEditSharedArtifact(grant)) return sharedAuthor(grant)
          if (principal && (role === 'owner' || role === 'editor')) return hubAuthor(principal)
        }
        throw new DomainError('FORBIDDEN', '当前权限不允许共同编辑')
      },
    })
    return c.json(result)
  })
}
