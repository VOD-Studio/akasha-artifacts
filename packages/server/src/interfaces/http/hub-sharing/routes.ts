import {
  ArtifactShareRoleSchema,
  HubInviteInputSchema,
  HubSharingOverrideSchema,
  HubSharingPolicySchema,
  PublicIdSchema,
} from '@akasha/protocol'
import { Hono } from 'hono'
import { z } from 'zod'
import type { HubSharing } from '../../../application/hub-sharing/service.js'
import { DomainError, NotFoundError } from '../../../domain/errors.js'
import type { ArtifactRepository } from '../../../domain/ports.js'
import { ownsHubProject } from '../hub-access.js'
import type { HubAuth } from '../hub-auth.js'
import { parseJsonBody } from '../request-body.js'

const policyUpdate = z.union([
  z.strictObject({ defaults: HubSharingPolicySchema }),
  z.strictObject({ override: HubSharingOverrideSchema }),
])
const roleUpdate = z.strictObject({ role: ArtifactShareRoleSchema })

interface SharingRoutesOptions {
  auth: HubAuth
  artifacts: ArtifactRepository
  sharing: HubSharing
}

/** 须在 Hub 同源中间件之后挂载；这里的会话检查不能由匿名链接或 CLI 凭证代替。 */
export function mountHubSharing(app: Hono, { auth, artifacts, sharing }: SharingRoutesOptions) {
  const routes = new Hono()
  routes.onError((error, c) => {
    if (error instanceof DomainError) {
      const response = { error: { code: error.code, message: error.message } }
      switch (error.code) {
        case 'BAD_REQUEST':
          return c.json(response, 400)
        case 'UNAUTHORIZED':
          return c.json(response, 401)
        case 'FORBIDDEN':
          return c.json(response, 403)
        case 'NOT_FOUND':
          return c.json(response, 404)
      }
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '服务器内部错误' } }, 500)
  })

  const requireSession = async (request: Request) => {
    const principal = await auth.authenticate(request)
    if (!principal) throw new DomainError('UNAUTHORIZED', '请先登录 Hub')
    if (principal.kind !== 'session') throw new DomainError('FORBIDDEN', '此操作需要浏览器会话')
    return principal
  }
  const activeArtifact = async (id: string) => {
    if (!PublicIdSchema.safeParse(id).success) throw new NotFoundError('未找到请求的资源')
    const artifact = await artifacts.findByPublicId(id)
    if (!artifact) throw new NotFoundError('未找到请求的资源')
    return artifact
  }
  const requireOwner = async (request: Request, artifactId: string) => {
    const principal = await requireSession(request)
    const artifact = await activeArtifact(artifactId)
    if (!ownsHubProject(principal, artifact.projectId)) throw new NotFoundError('未找到请求的资源')
    return { artifact, principal }
  }
  const requireAdmin = async (request: Request, artifactId: string) => {
    const principal = await requireSession(request)
    if (!auth.isAdministrator(principal))
      throw new DomainError('FORBIDDEN', '仅 Hub 管理员可管理分享策略')
    return activeArtifact(artifactId)
  }

  routes.get('/api/v1/artifacts/:id/sharing', async (c) => {
    const { artifact } = await requireOwner(c.req.raw, c.req.param('id'))
    return c.json(await sharing.list(artifact))
  })
  routes.post('/api/v1/artifacts/:id/invitations', async (c) => {
    const { artifact, principal } = await requireOwner(c.req.raw, c.req.param('id'))
    const input = await parseJsonBody(c.req.raw, HubInviteInputSchema)
    return c.json(await sharing.invite(artifact, principal, input), 201)
  })
  routes.post('/api/v1/artifacts/:id/sharing/only-me', async (c) => {
    const { artifact } = await requireOwner(c.req.raw, c.req.param('id'))
    await sharing.onlyMe(artifact)
    return c.json({ ok: true })
  })
  routes.patch('/api/v1/artifacts/:id/sharing/grants/:grantId', async (c) => {
    const { artifact } = await requireOwner(c.req.raw, c.req.param('id'))
    const { role } = await parseJsonBody(c.req.raw, roleUpdate)
    await sharing.changeRole(artifact, c.req.param('grantId'), role)
    return c.json({ ok: true })
  })
  routes.delete('/api/v1/artifacts/:id/sharing/grants/:grantId', async (c) => {
    const { artifact } = await requireOwner(c.req.raw, c.req.param('id'))
    await sharing.revoke(artifact, c.req.param('grantId'))
    return c.json({ ok: true })
  })
  routes.post('/api/v1/invitations/:id/accept', async (c) => {
    const principal = await auth.authenticate(c.req.raw)
    if (principal?.kind !== 'session') throw new DomainError('UNAUTHORIZED', '请先登录 Hub')
    return c.json(await sharing.acceptInvite(c.req.param('id'), principal))
  })
  routes.get('/api/v1/admin/sharing/:id', async (c) => {
    const artifact = await requireAdmin(c.req.raw, c.req.param('id'))
    return c.json(await sharing.readPolicy(artifact.publicId))
  })
  routes.put('/api/v1/admin/sharing/:id', async (c) => {
    const artifact = await requireAdmin(c.req.raw, c.req.param('id'))
    const update = await parseJsonBody(c.req.raw, policyUpdate)
    return c.json(await sharing.updatePolicy(artifact, update))
  })
  app.route('/', routes)
}
