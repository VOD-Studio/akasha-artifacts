import {
  AgentDesignInputSchema,
  AgentMessageInputSchema,
  ApplyRequestedTweaksInputSchema,
  ArtifactCheckInputSchema,
  ArtifactPublishInputSchema,
  ArtifactTypeSchema,
  ArtifactUpdateInputSchema,
  PublicIdSchema,
} from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { AgentSessions } from '../../application/agent-sessions.js'
import type { CheckService } from '../../application/check-service.js'
import type { SpecRegistry } from '../../application/spec-registry.js'
import { DomainError, NotFoundError } from '../../domain/errors.js'

const API = '/api/v1/agent'
export const LOCAL_AGENT_TOOL_PATH = `${API}/tool`
const TOOLS = LOCAL_AGENT_TOOL_PATH
const SESSION = '/api/v1/artifacts/:id/agent-session'
const ProjectInput = AgentDesignInputSchema.pick({ projectId: true })
const DetailQuery = z.object({
  projectId: z.string().optional(),
  version: z.coerce.number().int().positive().optional(),
})
const privateHeaders = { 'Cache-Control': 'private, no-store' }

interface LocalAgentRoutes {
  sessions: AgentSessions
  daemonToken: string
  checks: CheckService
  specs: SpecRegistry
  readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T>
  authorizeRead(request: Request): void
}

function artifactId(raw: string) {
  const id = PublicIdSchema.safeParse(raw)
  if (!id.success) throw new NotFoundError('未找到活动制品')
  return id.data
}

function requireCli(request: Request, token: string) {
  if (request.headers.has('Origin') || request.headers.get('Authorization') !== `Bearer ${token}`)
    throw new DomainError('FORBIDDEN', '连接或断开 CLI 只能由本机终端显式授权')
}

function bearer(request: Request) {
  return request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1] ?? ''
}

/** 只能挂在启用了本机 Host / Origin / Token 安全边界的 Daemon。 */
export function mountLocalAgentRoutes(
  app: Hono,
  { sessions, daemonToken, specs, checks, readBody, authorizeRead }: LocalAgentRoutes,
) {
  app.get(`${API}/connections`, async (c) => {
    authorizeRead(c.req.raw)
    return c.json({ connections: await sessions.listConnections() }, 200, privateHeaders)
  })
  app.post(`${API}/connections`, async (c) => {
    requireCli(c.req.raw, daemonToken)
    const { projectId } = await readBody(c.req.raw, ProjectInput)
    await sessions.connect(projectId)
    return c.json({ connected: true })
  })
  app.delete(`${API}/connections/:projectId`, (c) => {
    requireCli(c.req.raw, daemonToken)
    sessions.disconnect(c.req.param('projectId'))
    return c.json({ connected: false })
  })
  app.post(`${API}/design`, async (c) => {
    const { projectId, message } = await readBody(c.req.raw, AgentDesignInputSchema)
    return c.json(await sessions.startDesign(projectId, message), 202, privateHeaders)
  })
  app.get(`${API}/sessions/:id`, async (c) => {
    authorizeRead(c.req.raw)
    const id = z.uuid().safeParse(c.req.param('id'))
    if (!id.success) throw new NotFoundError('未找到已授权的 Agent 会话')
    return c.json(await sessions.conversation(id.data), 200, privateHeaders)
  })
  app.get(SESSION, async (c) => {
    authorizeRead(c.req.raw)
    return c.json(await sessions.forArtifact(artifactId(c.req.param('id'))), 200, privateHeaders)
  })
  app.post(SESSION, async (c) => {
    const { message, target, tweakApplication } = await readBody(c.req.raw, AgentMessageInputSchema)
    return c.json(
      await sessions.continueArtifact(
        artifactId(c.req.param('id')),
        message,
        target,
        tweakApplication,
      ),
      202,
      privateHeaders,
    )
  })

  app.use(`${TOOLS}/*`, async (c, next) => {
    // 轮次工具是无 Cookie 的 CLI 专用通道；不能转交给浏览器或第三方 Origin。
    if (c.req.raw.headers.has('Origin'))
      throw new DomainError('FORBIDDEN', '轮次工具只能由本机 CLI 调用')
    sessions.authorizeTool(bearer(c.req.raw))
    await next()
  })
  app.get(`${TOOLS}/specs/:type`, (c) => {
    const type = ArtifactTypeSchema.safeParse(c.req.param('type'))
    if (!type.success) throw new DomainError('BAD_REQUEST', '不支持的制品类型')
    return c.json(specs.getSpec(type.data), 200, privateHeaders)
  })
  app.post(`${TOOLS}/artifacts/check`, async (c) => {
    const { type, source } = await readBody(c.req.raw, ArtifactCheckInputSchema)
    return c.json(checks.check({ type, source }), 200, privateHeaders)
  })
  app.post(`${TOOLS}/apply-requested-tweaks`, async (c) => {
    await readBody(c.req.raw, ApplyRequestedTweaksInputSchema)
    return c.json(await sessions.applyRequestedTweaks(bearer(c.req.raw)), 200, privateHeaders)
  })
  app.post(`${TOOLS}/artifacts`, async (c) => {
    const input = await readBody(c.req.raw, ArtifactPublishInputSchema)
    const checked = checks.check({ type: input.type, source: input.source })
    if (!checked.ok) throw new DomainError('BAD_REQUEST', '制品未通过发布前校验', checked.errors)
    const published = await sessions.publish(bearer(c.req.raw), input)
    return c.json(published, 201, privateHeaders)
  })
  app.get(`${TOOLS}/artifacts/:id`, async (c) => {
    const query = DetailQuery.safeParse(c.req.query())
    if (!query.success) throw new DomainError('BAD_REQUEST', '制品版本参数无效')
    const { projectId, version } = query.data
    return c.json(
      await sessions.readArtifact(
        bearer(c.req.raw),
        artifactId(c.req.param('id')),
        projectId,
        version,
      ),
      200,
      privateHeaders,
    )
  })
  app.patch(`${TOOLS}/artifacts/:id`, async (c) => {
    const input = await readBody(c.req.raw, ArtifactUpdateInputSchema.omit({ id: true }))
    return c.json(
      await sessions.update(bearer(c.req.raw), { ...input, id: artifactId(c.req.param('id')) }),
      200,
      privateHeaders,
    )
  })
}
