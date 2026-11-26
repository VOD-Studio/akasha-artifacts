import { CodingSessionConnectSchema, CodingSessionPublishSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { publishCodingSession } from '../../../application/coding-publication.js'
import { CodingSessions } from '../../../application/coding-sessions.js'
import type { ArtifactStorageRepository } from '../../../domain/artifact-storage.js'
import { DomainError } from '../../../domain/errors.js'
import type { HttpAppDeps } from '../dependencies.js'
import { parseJsonBody } from '../request-body.js'

/** 整机凭证仅用于 CLI 签入；恢复时不接受 Cookie、整机令牌或客户端重传的选区。 */
export function mountCodingSessionRoutes(
  app: Hono,
  deps: HttpAppDeps,
  store: ArtifactStorageRepository,
) {
  const sessions = new CodingSessions(store, deps.artifacts, deps.projects, deps.clock)
  const root = '/api/v1/projects/:project/coding-sessions'
  app.use(`${root}/:id/publish`, bodyLimit({ maxSize: 16 * 1024 * 1024 }))
  app.post(root, async (c) => {
    if (deps.security?.token && c.req.header('authorization') !== `Bearer ${deps.security.token}`)
      throw new DomainError('FORBIDDEN', '请在项目终端签入编码会话')
    const { label, reference } = await parseJsonBody(c.req.raw, CodingSessionConnectSchema)
    c.header('Cache-Control', 'no-store')
    return c.json(await sessions.connect(c.req.param('project'), label, reference), 201)
  })
  app.post(`${root}/:id/read`, async (c) => {
    c.header('Cache-Control', 'no-store')
    return c.json(
      await sessions.read(
        c.req.param('project'),
        c.req.param('id'),
        c.req.header('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '',
      ),
    )
  })
  app.post(`${root}/:id/publish`, async (c) => {
    const id = c.req.param('id')
    const reference = await sessions.authorize(
      c.req.param('project'),
      id,
      c.req.header('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? '',
    )
    const input = await parseJsonBody(c.req.raw, CodingSessionPublishSchema)
    return c.json(await publishCodingSession(deps, id, reference, input), 201)
  })
}
