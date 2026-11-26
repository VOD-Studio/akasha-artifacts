import { RemoveAgentReferenceSchema, StageAgentReferenceSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { AgentSessions } from '../../../application/agent-sessions.js'
import { parseJsonBody } from '../request-body.js'

/** 仅本机已认证的维护者可暂存材料；轮次 MCP 凭证不能访问这些端点。 */
export function mountAgentReferenceRoutes(app: Hono, sessions: AgentSessions) {
  const path = '/api/v1/agent/references'
  app.use(
    path,
    bodyLimit({
      maxSize: 3 * 1024 * 1024,
      onError: (c) => c.json({ error: { code: 'BAD_REQUEST', message: '材料超过上传上限' } }, 413),
    }),
  )
  app.post(path, async (c) => {
    const { scope, file } = await parseJsonBody(c.req.raw, StageAgentReferenceSchema)
    return c.json(await sessions.stageReference(scope, file), 201, {
      'Cache-Control': 'private, no-store',
    })
  })
  app.delete(path, async (c) => {
    const { scope, id } = await parseJsonBody(c.req.raw, RemoveAgentReferenceSchema)
    sessions.removeReference(scope, id)
    return c.body(null, 204)
  })
}
