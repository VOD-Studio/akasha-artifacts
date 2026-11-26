import {
  CatalogGenerateInputSchema,
  PublicIdSchema,
  SystemMembersSchema,
  SystemPreferenceSchema,
  SystemPublicationInputSchema,
} from '@akasha/protocol'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { SystemCatalog } from '../../application/design-systems/catalog.js'
import type { HubPrincipal } from '../../application/hub-sharing/authority.js'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import type { ProjectRepository } from '../../domain/ports.js'
import { hubAuthor, ownsHubProject } from './hub-access.js'
import type { HubAuth } from './hub-auth.js'
import { invalid } from './hub-sharing/responses.js'
import { parseJsonBody } from './request-body.js'

/** Hub 的定向目录只接受当前组织成员的同源浏览器会话，不走通用制品读取授权。 */
export function mountSystemCatalog(
  app: Hono,
  auth: HubAuth,
  catalog: SystemCatalog,
  projects: ProjectRepository,
) {
  const routes = new Hono<{ Variables: { principal: HubPrincipal } }>()
  const root = '/api/v1/projects/:projectId/system-catalog'
  routes.onError((error, c) => {
    if (error instanceof DomainError) {
      const response = {
        error: { code: error.code, message: error.message, details: error.details },
      }
      switch (error.code) {
        case 'BAD_REQUEST':
          return c.json(response, 400)
        case 'NOT_FOUND':
          return c.json(response, 404)
        case 'FORBIDDEN':
          return c.json(response, 403)
        case 'RESOURCE_CONFLICT':
          return c.json(response, 409)
      }
    }
    return c.json({ error: { code: 'INTERNAL_ERROR', message: '无法读取系统目录' } }, 500)
  })
  routes.use(`${root}/*`, bodyLimit({ maxSize: 64 * 1024, onError: invalid }))
  routes.use(`${root}/*`, async (c, next) => {
    const principal = await auth.authenticate(c.req.raw)
    const projectId = c.req.param('projectId')
    if (
      !principal ||
      principal.kind !== 'session' ||
      !ownsHubProject(principal, projectId) ||
      !(await projects.findById(projectId))
    )
      throw new NotFoundError('未找到请求的资源')
    c.set('principal', principal)
    await next()
  })
  routes.get(root, async (c) =>
    c.json(await catalog.list(c.req.param('projectId'), c.get('principal').userId)),
  )
  routes.put(`${root}/preference`, async (c) => {
    const { inheritDefault } = await parseJsonBody(c.req.raw, SystemPreferenceSchema)
    await catalog.members.setInheritDefault(c.get('principal').userId, inheritDefault)
    return c.json({ inheritDefault })
  })
  routes.post(`${root}/generate`, async (c) => {
    const principal = c.get('principal')
    const input = await parseJsonBody(c.req.raw, CatalogGenerateInputSchema)
    const result = await catalog.generate(
      c.req.param('projectId'),
      principal.userId,
      hubAuthor(principal),
      input,
    )
    return c.json(result, 201)
  })
  routes.put(`${root}/:id/:version/publication`, async (c) => {
    const principal = c.get('principal')
    if (!auth.isAdministrator(principal))
      throw new DomainError('FORBIDDEN', '只有 Hub 管理员可管理团队系统')
    const { projectId, id, version } = c.req.param()
    if (!PublicIdSchema.safeParse(id).success || !/^[1-9]\d*$/.test(version))
      throw new NotFoundError('未找到请求的资源')
    const { action } = await parseJsonBody(c.req.raw, SystemPublicationInputSchema)
    await catalog.changePublication(projectId, principal.userId, id, Number(version), action)
    return c.json({ ok: true })
  })
  const members = `${root}/:id/:version/members` as const
  routes.on(['GET', 'PUT'], members, async (c) => {
    const { projectId, id, version } = c.req.param()
    if (!PublicIdSchema.safeParse(id).success || !/^[1-9]\d*$/.test(version))
      throw new NotFoundError('未找到请求的资源')
    const pin = await catalog.pin(projectId, id, Number(version))
    if (!pin || !(await catalog.fixed(pin))) throw new NotFoundError('未找到请求的资源')
    if (c.req.method === 'PUT') {
      const { logins } = await parseJsonBody(c.req.raw, SystemMembersSchema)
      const members = []
      for (const login of new Set(logins.map((value) => value.toLowerCase()))) {
        const member = await auth.lookupMember(c.get('principal'), login)
        if (!member) throw new DomainError('BAD_REQUEST', '无法确认指定的 Hub 成员')
        members.push(member)
      }
      await catalog.members.setMembers(pin, members)
    }
    return c.json({ logins: (await catalog.members.getMembers(pin)).map(({ login }) => login) })
  })
  app.route('/', routes)
}
