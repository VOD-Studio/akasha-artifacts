import { AgentActivityStateSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ProjectRepository, RealtimeSubscriber } from '../../../domain/ports.js'
import type { DaemonInfoProvider } from '../dependencies.js'
import { parseJsonBody } from '../request-body.js'

const AgentActivityBodySchema = z.object({
  projectId: z.string().min(1),
  artifactId: z.string().min(1).optional(),
  state: AgentActivityStateSchema,
  summary: z.string().optional(),
})

interface DaemonRoutes {
  daemon: DaemonInfoProvider
  projects: Pick<ProjectRepository, 'list'>
  realtime: Pick<RealtimeSubscriber, 'getActiveConnections'>
}

export function mountDaemonRoutes(app: Hono, deps: DaemonRoutes) {
  app.get('/api/v1/health', (c) => {
    return c.json({ ok: true as const, version: deps.daemon.version })
  })

  app.get('/api/v1/daemon/status', async (c) => {
    const projects = await deps.projects.list()
    const uptimeSec = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(deps.daemon.startedAt)) / 1000),
    )
    return c.json({
      status: 'running' as const,
      version: deps.daemon.version,
      pid: deps.daemon.pid,
      port: deps.daemon.port,
      sandboxPort: deps.daemon.sandboxPort,
      uptimeSec,
      projectCount: projects.length,
      activeConnections: deps.realtime.getActiveConnections(),
      relayState: deps.daemon.relayState,
      startedAt: deps.daemon.startedAt,
    })
  })

  app.get('/api/v1/daemon/logs', (c) => {
    const projectId = c.req.query('projectId')
    const limitParam = c.req.query('limit')
    const limit = limitParam
      ? Math.min(300, Math.max(1, Number.parseInt(limitParam, 10) || 100))
      : 100
    return c.json({ entries: deps.daemon.listLogs(projectId, limit) })
  })

  app.post('/api/v1/agent/activity', async (c) => {
    const body = await parseJsonBody(c.req.raw, AgentActivityBodySchema)
    await deps.daemon.reportAgentActivity(body)
    return c.json({ ok: true as const })
  })

  // 先应答再触发退出，保证响应先送达
  app.post('/api/v1/daemon/shutdown', (c) => {
    if (deps.daemon.requestShutdown) {
      setTimeout(() => deps.daemon.requestShutdown?.(), 20)
    }
    return c.json({ ok: true as const, status: 'stopping' as const })
  })
}
