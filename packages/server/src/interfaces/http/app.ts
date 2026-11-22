import {
  AgentActivityStateSchema,
  ArtifactAckFeedbackInputSchema,
  ArtifactAwaitFeedbackInputSchema,
  ArtifactCheckInputSchema,
  ArtifactPublishInputSchema,
  ArtifactPushStateInputSchema,
  ArtifactRecordVerdictInputSchema,
  ArtifactTypeSchema,
  ArtifactUpdateInputSchema,
  AuthorSchema,
  ElementRefSchema,
  type ErrorCode,
  FeedbackKindSchema,
  ReviewGroupSchema,
} from '@akasha/protocol'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { ArtifactService } from '../../application/artifact-service.js'
import type { CheckService } from '../../application/check-service.js'
import type { SpecRegistry } from '../../application/spec-registry.js'
import { DomainError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  ProjectRepository,
  RealtimeSubscriber,
} from '../../domain/ports.js'

export interface HttpSecurityConfig {
  // 防 DNS rebinding：允许的 Host 头白名单（例如 ['localhost:24321', '127.0.0.1:24321']）
  allowedHosts?: readonly string[]
  // 写接口鉴权令牌（Bearer token 或同源 session cookie）
  token?: string
  cookieName?: string
  // 跨站写请求 Origin 白名单
  allowedOrigins?: readonly string[]
}

export interface DaemonInfoProvider {
  version: string
  pid: number
  port: number
  sandboxPort: number
  startedAt: string
  relayState: 'local_only' | 'connected' | 'degraded' | 'rate_limited'
  listLogs: (projectId?: string, limit?: number) => readonly unknown[]
  reportAgentActivity: (input: {
    projectId: string
    artifactId?: string
    state: 'editing' | 'idle' | 'offline'
    summary?: string
  }) => Promise<void>
  requestShutdown?: () => void
}

export interface HttpAppDeps {
  service: ArtifactService
  checks: CheckService
  specs: SpecRegistry
  projects: ProjectRepository
  artifacts: ArtifactRepository
  realtime: RealtimeSubscriber
  clock: Clock
  daemon: DaemonInfoProvider
  security?: HttpSecurityConfig
}

const RegisterProjectBodySchema = z.object({
  id: z.string().min(1).optional(),
  rootPath: z.string().min(1),
  name: z.string().min(1),
})

const PublishBodySchema = ArtifactPublishInputSchema.extend({
  author: AuthorSchema.optional().default('agent:cli'),
})

const UpdateBodySchema = ArtifactUpdateInputSchema.omit({ id: true }).extend({
  author: AuthorSchema.optional().default('agent:cli'),
})

const RevertBodySchema = z.object({
  project: z.string().min(1).optional(),
  targetVersion: z.number().int().min(1),
  baseVersion: z.number().int().min(1),
  author: AuthorSchema.optional().default('human:local'),
})

const OpenRoundBodySchema = z.object({
  project: z.string().min(1).optional(),
  groups: z.array(ReviewGroupSchema).min(1),
})

const SubmitFeedbackBodySchema = z.object({
  project: z.string().min(1).optional(),
  version: z.number().int().min(1),
  roundId: z.string().min(1).nullable().optional(),
  groupId: z.string().min(1).nullable().optional(),
  kind: FeedbackKindSchema,
  element: ElementRefSchema.nullable().optional(),
  body: z.string(),
  author: AuthorSchema.optional().default('human:local'),
})

const AgentActivityBodySchema = z.object({
  projectId: z.string().min(1),
  artifactId: z.string().min(1).optional(),
  state: AgentActivityStateSchema,
  summary: z.string().optional(),
})

const OtcCreateBodySchema = z.object({
  // 仅允许站内相对路径，防止开放重定向
  next: z
    .string()
    .regex(/^\/(?!\/)[^\r\n]*$/, 'next 须为站内相对路径')
    .optional()
    .default('/'),
})

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function errorCodeToStatus(code: ErrorCode): ContentfulStatusCode {
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'VERSION_CONFLICT':
      return 409
    case 'MATCH_NOT_FOUND':
    case 'AMBIGUOUS_MATCH':
    case 'PATCH_FAILED':
    case 'ROUND_LOCKED':
    case 'INVALID_RECEIPT':
      return 422
    case 'RATE_LIMITED':
      return 429
    default:
      return 500
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const ct = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!ct.includes('application/json')) {
    throw new DomainError('BAD_REQUEST', 'Content-Type 必须为 application/json')
  }
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new DomainError('BAD_REQUEST', '请求体必须是合法 JSON')
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new DomainError('BAD_REQUEST', '请求参数校验失败', result.error.issues)
  }
  return result.data
}

// Hono HTTP 接口层：遵循纯 Web 标准 Request/Response，同时适配 Node 本地 Daemon 与 Cloudflare Workers。
export function createHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono()
  // 一次性浏览器登录码：60 秒有效且仅可消费一次，用于 akasha open 换取 HttpOnly Cookie
  const otcStore = new Map<string, { next: string; expiresAt: number }>()

  // 本地安全边界中间件：Host 校验（防 DNS rebinding）、Origin 校验与写接口鉴权
  if (deps.security) {
    const sec = deps.security
    app.use('*', async (c, next) => {
      if (sec.allowedHosts && sec.allowedHosts.length > 0) {
        const host = c.req.header('host')?.toLowerCase()
        if (!host || !sec.allowedHosts.some((h) => h.toLowerCase() === host)) {
          return c.json(
            { error: { code: 'FORBIDDEN', message: `拒绝非法 Host 头 "${host ?? ''}"` } },
            403,
          )
        }
      }
      await next()
    })

    app.use('/api/v1/*', async (c, next) => {
      const method = c.req.method.toUpperCase()
      const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
      const isWsUpgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket'
      if (isMutation || isWsUpgrade) {
        const origin = c.req.header('origin')
        if (origin && sec.allowedOrigins && !sec.allowedOrigins.includes(origin)) {
          return c.json(
            { error: { code: 'FORBIDDEN', message: `拒绝跨站 Origin "${origin}"` } },
            403,
          )
        }
      }
      if (isMutation && sec.token) {
        const auth = c.req.header('authorization')
        const bearerOk = auth === `Bearer ${sec.token}`
        const cookieName = sec.cookieName ?? 'akasha_session'
        const cookies = parseCookies(c.req.header('cookie'))
        const cookieOk = cookies[cookieName] === sec.token
        if (!bearerOk && !cookieOk) {
          return c.json(
            { error: { code: 'UNAUTHORIZED', message: '缺少有效的访问令牌或同源会话凭证' } },
            401,
          )
        }
      }
      await next()
    })
  }

  app.onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json(
        {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        },
        errorCodeToStatus(err.code),
      )
    }
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: err instanceof Error ? err.message : '服务器内部错误',
        },
      },
      500,
    )
  })

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

  app.get('/api/v1/projects', async (c) => {
    const projects = await deps.projects.list()
    const nowMs = Date.parse(deps.clock.now())
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    return c.json({
      projects: projects.map((p) => ({
        ...p,
        dormant: nowMs - Date.parse(p.lastActiveAt) > sevenDaysMs,
      })),
    })
  })

  app.post('/api/v1/projects', async (c) => {
    const body = await parseJsonBody(c.req.raw, RegisterProjectBodySchema)
    const project = await deps.service.registerProject(body)
    return c.json({ project }, 201)
  })

  app.delete('/api/v1/projects/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await deps.projects.remove(id)
    if (!removed) {
      throw new DomainError('NOT_FOUND', `未找到项目 "${id}"`)
    }
    return c.json({ ok: true as const, id })
  })

  app.get('/api/v1/artifacts', async (c) => {
    const projectId = c.req.query('projectId')
    const artifacts = await deps.artifacts.listByProject(projectId)
    return c.json({ artifacts })
  })

  app.post('/api/v1/artifacts/check', async (c) => {
    const body = await parseJsonBody(c.req.raw, ArtifactCheckInputSchema)
    const result = deps.checks.check({ type: body.type, source: body.source })
    return c.json(result)
  })

  app.get('/api/v1/specs/:type', (c) => {
    const parsed = ArtifactTypeSchema.safeParse(c.req.param('type'))
    if (!parsed.success) {
      throw new DomainError('BAD_REQUEST', `不支持的 Artifact 类型 "${c.req.param('type')}"`)
    }
    return c.json(deps.specs.getSpec(parsed.data))
  })

  app.post('/api/v1/artifacts', async (c) => {
    const body = await parseJsonBody(c.req.raw, PublishBodySchema)
    const isNew = body.baseVersion === undefined
    const result = await deps.service.publish({
      projectId: body.project,
      slug: body.slug,
      title: body.title,
      type: body.type,
      source: body.source,
      baseVersion: body.baseVersion,
      visibility: body.visibility,
      author: body.author,
    })
    return c.json(
      {
        artifact: result.artifact,
        version: result.version,
        ...(isNew && result.version.version === 1
          ? { specHint: deps.specs.getSpec(result.artifact.type).guide }
          : {}),
      },
      result.version.version === 1 ? 201 : 200,
    )
  })

  app.get('/api/v1/artifacts/:id', async (c) => {
    const id = c.req.param('id')
    const projectId = c.req.query('projectId')
    const versionParam = c.req.query('version')
    const version = versionParam ? Number.parseInt(versionParam, 10) : undefined
    if (versionParam && (!Number.isInteger(version) || (version ?? 0) < 1)) {
      throw new DomainError('BAD_REQUEST', 'version 参数必须为正整数')
    }
    const data = await deps.service.getArtifact({ id, projectId, version })
    return c.json(data)
  })

  app.patch('/api/v1/artifacts/:id', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, UpdateBodySchema)
    const result = await deps.service.update({
      id,
      projectId: body.project,
      baseVersion: body.baseVersion,
      title: body.title,
      edits: body.edits,
      author: body.author,
    })
    return c.json(result)
  })

  app.post('/api/v1/artifacts/:id/revert', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, RevertBodySchema)
    const result = await deps.service.revert({
      id,
      projectId: body.project,
      targetVersion: body.targetVersion,
      baseVersion: body.baseVersion,
      author: body.author,
    })
    return c.json(result)
  })

  app.get('/api/v1/artifacts/:id/versions', async (c) => {
    const id = c.req.param('id')
    const projectId = c.req.query('projectId')
    const versions = await deps.service.getHistory(id, projectId)
    return c.json({ versions })
  })

  app.get('/api/v1/artifacts/:id/state', async (c) => {
    const id = c.req.param('id')
    const projectId = c.req.query('projectId')
    const seqParam = c.req.query('seq')
    const seq = seqParam !== undefined ? Number.parseInt(seqParam, 10) : undefined
    if (seqParam !== undefined && (!Number.isInteger(seq) || (seq ?? -1) < 0)) {
      throw new DomainError('BAD_REQUEST', 'seq 参数必须为非负整数')
    }
    const data = await deps.service.getStateAt({ id, projectId, seq })
    return c.json(data)
  })

  app.post('/api/v1/artifacts/:id/state', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, ArtifactPushStateInputSchema.omit({ id: true }))
    const snapshot = await deps.service.pushState({
      id,
      projectId: body.project,
      ops: body.patch,
    })
    return c.json({ publicId: snapshot.artifactId, seq: snapshot.seq, snapshot: snapshot.snapshot })
  })

  app.post('/api/v1/artifacts/:id/rounds', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, OpenRoundBodySchema)
    const round = await deps.service.openRound({
      id,
      projectId: body.project,
      groups: body.groups,
    })
    return c.json({ round }, 201)
  })

  app.post('/api/v1/artifacts/:id/rounds/:roundId/submit', async (c) => {
    const id = c.req.param('id')
    const roundId = c.req.param('roundId')
    const projectId = c.req.query('projectId')
    const round = await deps.service.submitRound({ id, projectId, roundId })
    return c.json({ round })
  })

  app.post('/api/v1/artifacts/:id/rounds/:roundId/withdraw', async (c) => {
    const id = c.req.param('id')
    const roundId = c.req.param('roundId')
    const projectId = c.req.query('projectId')
    const round = await deps.service.withdrawRound({ id, projectId, roundId })
    return c.json({ round })
  })

  app.post('/api/v1/artifacts/:id/verdict', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(
      c.req.raw,
      ArtifactRecordVerdictInputSchema.omit({ id: true }).extend({
        fromAgent: z.boolean().optional().default(true),
      }),
    )
    const round = await deps.service.recordDecision({
      id,
      projectId: body.project,
      roundId: body.roundId,
      groupId: body.groupId,
      choice: body.choice,
      verdict: body.verdict,
      note: body.note,
      submitRound: body.submitRound,
      fromAgent: body.fromAgent,
    })
    return c.json({ round })
  })

  app.post('/api/v1/artifacts/:id/feedback', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, SubmitFeedbackBodySchema)
    const feedback = await deps.service.submitFeedback({
      id,
      projectId: body.project,
      version: body.version,
      roundId: body.roundId,
      groupId: body.groupId,
      kind: body.kind,
      element: body.element,
      body: body.body,
      author: body.author,
    })
    return c.json({ feedback }, 201)
  })

  app.get('/api/v1/feedback', async (c) => {
    const id = c.req.query('id')
    const projectId = c.req.query('projectId')
    const after = c.req.query('after')
    const includeDrafts = c.req.query('includeDrafts') === 'true'
    const detail = c.req.query('detail') !== 'false'
    const result = await deps.service.pullFeedback({
      id,
      projectId,
      after,
      includeDrafts,
      detail,
    })
    return c.json(result)
  })

  app.post('/api/v1/feedback/ack', async (c) => {
    const body = await parseJsonBody(c.req.raw, ArtifactAckFeedbackInputSchema)
    const result = await deps.service.ackFeedback(body)
    return c.json(result)
  })

  // 阻塞等待反馈（无异步 Hook 时的兜底 long-poll）：先订阅再首查，消除竞态漏唤醒窗口
  app.post('/api/v1/feedback/await', async (c) => {
    const body = await parseJsonBody(c.req.raw, ArtifactAwaitFeedbackInputSchema)
    const artifact = await deps.service.resolveArtifact(body.id, body.project)

    let resolveWake: ((reason: 'feedback' | 'round' | 'timeout') => void) | undefined
    let earlyWake: 'feedback' | 'round' | undefined
    const unsubscribe = deps.realtime.subscribe({
      artifactId: artifact.publicId,
      onEvent: (event) => {
        if (event.type === 'feedback.created') {
          earlyWake = 'feedback'
          resolveWake?.('feedback')
        } else if (event.type === 'round.updated' && event.round.status === 'submitted') {
          earlyWake = 'round'
          resolveWake?.('round')
        }
      },
    })

    try {
      const initial = await deps.service.pullFeedback({
        id: artifact.publicId,
        after: body.after,
        detail: true,
      })
      if (initial.items.length > 0) {
        return c.json({ status: 'received' as const, ...initial })
      }

      const timeoutMs = body.timeoutSec * 1000
      const reason = earlyWake
        ? earlyWake
        : await new Promise<'feedback' | 'round' | 'timeout'>((resolve) => {
            let settled = false
            const finish = (r: 'feedback' | 'round' | 'timeout') => {
              if (settled) return
              settled = true
              clearTimeout(timer)
              resolve(r)
            }
            resolveWake = finish
            const timer = setTimeout(() => finish('timeout'), timeoutMs)
          })

      if (reason === 'timeout') {
        return c.json({
          status: 'pending' as const,
          items: [],
          rounds: initial.rounds,
          cursor: initial.cursor,
        })
      }

      const next = await deps.service.pullFeedback({
        id: artifact.publicId,
        after: body.after,
        detail: true,
      })
      // 整轮提交可能仅包含方案选择/验收裁决而无文字评论，同样视作已收到结果
      return c.json({
        status:
          next.items.length > 0 || reason === 'round'
            ? ('received' as const)
            : ('pending' as const),
        ...next,
      })
    } finally {
      unsubscribe()
    }
  })

  app.post('/api/v1/agent/activity', async (c) => {
    const body = await parseJsonBody(c.req.raw, AgentActivityBodySchema)
    await deps.daemon.reportAgentActivity(body)
    return c.json({ ok: true as const })
  })

  app.post('/api/v1/auth/otc', async (c) => {
    const body = await parseJsonBody(c.req.raw, OtcCreateBodySchema)
    const now = Date.now()
    for (const [k, v] of otcStore.entries()) {
      if (v.expiresAt <= now) otcStore.delete(k)
    }
    const code = randomHex(16)
    otcStore.set(code, { next: body.next, expiresAt: now + 60_000 })
    return c.json({ code, openPath: `/auth/open?otc=${code}` }, 201)
  })

  app.get('/auth/open', (c) => {
    const code = c.req.query('otc')
    if (!code) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: '缺少一次性访问码' } }, 401)
    }
    const entry = otcStore.get(code)
    otcStore.delete(code)
    if (!entry || entry.expiresAt <= Date.now()) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: '一次性访问码无效或已过期' } }, 401)
    }
    if (deps.security?.token) {
      const cookieName = deps.security.cookieName ?? 'akasha_session'
      c.header(
        'Set-Cookie',
        `${cookieName}=${encodeURIComponent(deps.security.token)}; HttpOnly; SameSite=Lax; Path=/`,
      )
    }
    return c.redirect(entry.next, 302)
  })

  app.post('/api/v1/daemon/shutdown', (c) => {
    if (deps.daemon.requestShutdown) {
      setTimeout(() => deps.daemon.requestShutdown?.(), 20)
    }
    return c.json({ ok: true as const, status: 'stopping' as const })
  })

  app.notFound((c) => {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `路由 ${c.req.method} ${c.req.path} 不存在` } },
      404,
    )
  })

  return app
}
