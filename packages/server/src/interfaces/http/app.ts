import {
  AgentActivityStateSchema,
  ArtifactAckFeedbackInputSchema,
  ArtifactAwaitFeedbackInputSchema,
  ArtifactCheckInputSchema,
  ArtifactPublishInputSchema,
  ArtifactPushStateInputSchema,
  ArtifactRecordVerdictInputSchema,
  ArtifactStorageOperationSchema,
  ArtifactTransferInputSchema,
  ArtifactTypeSchema,
  ArtifactUpdateInputSchema,
  AuthorSchema,
  EditOpSchema,
  ElementRefSchema,
  type ErrorCode,
  FeedbackKindSchema,
  FeedbackSchema,
  PublicIdSchema,
  ReviewGroupSchema,
} from '@akasha/protocol'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import type { AgentSessions } from '../../application/agent-sessions.js'
import { listArtifactFavorites, setArtifactFavorite } from '../../application/artifact-favorites.js'
import type { ArtifactService } from '../../application/artifact-service.js'
import {
  executeArtifactStorage,
  getArtifactStorageUsage,
} from '../../application/artifact-storage.js'
import type { CheckService } from '../../application/check-service.js'
import type { SpecRegistry } from '../../application/spec-registry.js'
import type { ArtifactStorageRepository } from '../../domain/artifact-storage.js'
import { DomainError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  ProjectRepository,
  RealtimeSubscriber,
} from '../../domain/ports.js'
import { LOCAL_AGENT_TOOL_PATH, mountLocalAgentRoutes } from './local-agent.js'

/** 本地 Daemon 的安全边界配置；Hub 不传，改由 `mountHubGuard` 做同源与角色校验。 */
export interface HttpSecurityConfig {
  // 防 DNS rebinding：允许的 Host 头白名单（例如 ['localhost:24321', '127.0.0.1:24321']）
  allowedHosts?: readonly string[]
  // 写接口鉴权令牌（Bearer token 或同源 session cookie）
  token?: string
  // 承载 token 的 cookie 名，缺省 akasha_session
  cookieName?: string
  // 跨站写请求 Origin 白名单
  allowedOrigins?: readonly string[]
}

/** 状态、日志与活跃状态接口的数据来源；本地由容器提供，Hub 以固定值填充。 */
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
  // 省略时 shutdown 接口只应答，不做任何事
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
  // 省略时制品存储接口返回 404
  artifactStorage?: ArtifactStorageRepository
  // 从请求解析制品存储的调用方身份；null 表示未登录。省略时视为本地单一用户
  storagePrincipal?: (request: Request) => Promise<string | null>
  // 收藏保留用户意愿，但列出时仍须检查当前权限；本地只验证制品仍存在。
  canReadFavorite?: (request: Request, artifactId: string) => Promise<boolean>
  // 仅装配本机 CLI 的容器提供。
  agentSessions?: AgentSessions
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
const ReplaceBodySchema = UpdateBodySchema.omit({ edits: true }).extend({ source: z.string() })

const RevertBodySchema = z.object({
  project: z.string().min(1).optional(),
  targetVersion: z.number().int().min(1),
  baseVersion: z.number().int().min(1),
  author: AuthorSchema.optional().default('human:local'),
})

const VisualTargetQuerySchema = z.object({
  project: z.string().min(1).optional(),
  baseVersion: z.coerce.number().int().positive(),
  boardId: z.string().min(1).max(1024).optional(),
  loc: z
    .string()
    .regex(/^\d+:\d+$/)
    .optional(),
})

const VisualEditBaseSchema = z.object({
  project: z.string().min(1).optional(),
  baseVersion: z.number().int().positive(),
  author: AuthorSchema.optional().default('human:web'),
})

const VisualEditBodySchema = z.union([
  VisualEditBaseSchema.extend({
    op: EditOpSchema,
    boardId: z.string().min(1).max(1024).optional(),
  }).strict(),
  VisualEditBaseSchema.extend({ undoVersion: z.number().int().positive() }).strict(),
])

const OpenRoundBodySchema = z.object({
  project: z.string().min(1).optional(),
  groups: z.array(ReviewGroupSchema).min(1),
})

const SubmitFeedbackBodySchema = z
  .object({
    project: z.string().min(1).optional(),
    version: z.number().int().min(1),
    roundId: z.string().min(1).nullable().optional(),
    groupId: z.string().min(1).nullable().optional(),
    kind: FeedbackKindSchema,
    audience: FeedbackSchema.shape.audience,
    element: ElementRefSchema.nullable().optional(),
    body: z.string(),
    author: AuthorSchema.optional().default('human:local'),
  })
  .refine((input) => input.kind === 'comment' || input.audience === undefined, {
    message: '仅文字批注可指定投递对象',
    path: ['audience'],
  })

const DiscussionBodySchema = z.object({
  project: z.string().min(1).optional(),
  author: AuthorSchema.optional().default('human:local'),
  // Hub 根据访问角色覆写；本机写请求已经过 Daemon 鉴权。
  includeDrafts: z.boolean().optional().default(true),
})

const AgentActivityBodySchema = z.object({
  projectId: z.string().min(1),
  artifactId: z.string().min(1).optional(),
  state: AgentActivityStateSchema,
  summary: z.string().optional(),
})

const ProjectSelectionBodySchema = z.object({
  artifactId: z.string().min(1).optional(),
  element: ElementRefSchema.nullable(),
  draftText: z.string().max(4000).optional(),
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

// Hub 守卫在转发前自行拒绝的请求不经过这里：例如 INVALID_RECEIPT，守卫回 400，这里映射为 422
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
    case 'RESOURCE_CONFLICT':
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

// Content-Type、JSON 语法与 schema 校验的失败都归一为 BAD_REQUEST
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

/**
 * Hono HTTP 接口层：只依赖 Web 标准的 `Request` / `Response`，同时适配 Node 本地 Daemon 与
 * Cloudflare Workers。
 *
 * @remarks 传入 `security` 才启用 Host / Origin / Token 校验；领域错误在此统一转为错误信封。
 */
export function createHttpApp(deps: HttpAppDeps): Hono {
  const app = new Hono()
  const storagePrincipal = (request: Request) =>
    deps.storagePrincipal?.(request) ?? Promise.resolve('local')
  // 一次性浏览器登录码：60 秒有效且仅可消费一次，用于 akasha open 换取 HttpOnly Cookie
  const otcStore = new Map<string, { next: string; expiresAt: number }>()
  // 项目级浏览器当前选区与草稿快照（供 UserPromptSubmit / PreInvocation Hook 即时注入上下文）
  const selectionStore = new Map<
    string,
    {
      projectId: string
      artifactId?: string
      element: z.infer<typeof ElementRefSchema> | null
      draftText?: string
      updatedAt: string
    }
  >()

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
      const scopedTool = deps.agentSessions && c.req.path.startsWith(`${LOCAL_AGENT_TOOL_PATH}/`)
      if (
        !scopedTool &&
        (isMutation || c.req.path === '/api/v1/withdrawn-artifacts') &&
        sec.token
      ) {
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

  const localToken = deps.security?.token
  if (deps.agentSessions && localToken) {
    mountLocalAgentRoutes(app, {
      sessions: deps.agentSessions,
      daemonToken: localToken,
      checks: deps.checks,
      specs: deps.specs,
      readBody: parseJsonBody,
      authorizeRead(request) {
        const origin = request.headers.get('Origin')
        if (origin && !deps.security?.allowedOrigins?.includes(origin))
          throw new DomainError('FORBIDDEN', '拒绝跨站读取本机 Agent 会话')
        const name = deps.security?.cookieName ?? 'akasha_session'
        if (
          request.headers.get('Authorization') !== `Bearer ${localToken}` &&
          parseCookies(request.headers.get('Cookie') ?? undefined)[name] !== localToken
        )
          throw new DomainError('UNAUTHORIZED', '请先通过本机 Akasha 终端登录')
      },
    })
  }

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
    selectionStore.delete(id)
    return c.json({ ok: true as const, id })
  })

  app.get('/api/v1/projects/:id/selection', async (c) => {
    const id = c.req.param('id')
    const selected = selectionStore.get(id)
    if (selected?.artifactId) {
      const artifact = await deps.artifacts.findByPublicId(selected.artifactId)
      if (artifact?.projectId !== id) {
        if (selectionStore.get(id) === selected) selectionStore.delete(id)
        return c.json({ selection: null })
      }
    }
    return c.json({ selection: selected ?? null })
  })

  app.post('/api/v1/projects/:id/selection', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, ProjectSelectionBodySchema)
    if (!body.element && !body.draftText?.trim()) {
      selectionStore.delete(id)
      return c.json({ selection: null })
    }
    if (body.artifactId) {
      const artifact = await deps.artifacts.findByPublicId(body.artifactId)
      if (artifact?.projectId !== id)
        throw new DomainError('NOT_FOUND', '未找到当前项目内的活动制品')
    }
    const selection = {
      projectId: id,
      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
      element: body.element,
      ...(body.draftText !== undefined ? { draftText: body.draftText } : {}),
      updatedAt: deps.clock.now(),
    }
    selectionStore.set(id, selection)
    return c.json({ selection })
  })

  app.get('/api/v1/favorites', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '收藏存储未启用')
    const principal = await storagePrincipal(c.req.raw)
    if (!principal) throw new DomainError('UNAUTHORIZED', '请先登录后查看收藏')
    const ids = await listArtifactFavorites(deps.artifactStorage, principal)
    const visible = await Promise.all(
      ids.map(async (id) =>
        deps.canReadFavorite
          ? deps.canReadFavorite(c.req.raw, id)
          : Boolean(await deps.artifacts.findByPublicId(id)),
      ),
    )
    return c.json({ artifactIds: ids.filter((_, index) => visible[index]) }, 200, {
      'Cache-Control': 'private, no-store',
    })
  })

  app.put('/api/v1/artifacts/:id/favorite', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '收藏存储未启用')
    const principal = await storagePrincipal(c.req.raw)
    if (!principal) throw new DomainError('UNAUTHORIZED', '请先登录后收藏')
    const { favorite } = await parseJsonBody(c.req.raw, z.object({ favorite: z.boolean() }))
    const artifact = await deps.service.resolveArtifact(c.req.param('id'))
    await setArtifactFavorite(deps.artifactStorage, principal, artifact.publicId, favorite)
    return c.json({ favorite }, 200, { 'Cache-Control': 'private, no-store' })
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

  // 首次创建（得到 v1）返回 201，更新返回 200
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
    const input = { id, projectId, version }
    if (c.req.query('view') === 'canvas') {
      return c.json(await deps.service.getWorkspace(input), 200, {
        'Cache-Control': 'private, no-store',
      })
    }
    return c.json(await deps.service.getArtifact(input))
  })

  app.get('/api/v1/artifacts/:id/boards/:boardId', async (c) => {
    const rawVersion = c.req.query('version')
    const version = Number(rawVersion)
    if (!rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version)) {
      throw new DomainError('BAD_REQUEST', '读取画板必须指定正整数版本号')
    }
    const artifact = await deps.service.resolveArtifact(c.req.param('id'), c.req.query('projectId'))
    const board = await deps.service.workspace.getBoard(artifact, version, c.req.param('boardId'))
    if (!board) throw new DomainError('NOT_FOUND', '指定版本没有此画板')
    return c.json({ artifactId: artifact.publicId, version, board }, 200, {
      'Cache-Control': 'private, no-store',
    })
  })

  app.get('/api/v1/withdrawn-artifacts', async (c) => {
    const items = await deps.artifacts.lifecycle.listWithdrawn()
    return c.json({ items }, 200, { 'Cache-Control': 'private, no-store' })
  })

  app.delete('/api/v1/artifacts/:id', async (c) => {
    const artifact = await deps.service.setArtifactWithdrawal(c.req.param('id'), true)
    if (selectionStore.get(artifact.projectId)?.artifactId === artifact.publicId)
      selectionStore.delete(artifact.projectId)
    return c.json({ artifact })
  })

  app.post('/api/v1/artifacts/:id/restore', async (c) => {
    const artifact = await deps.service.setArtifactWithdrawal(c.req.param('id'), false)
    return c.json({ artifact })
  })

  app.get('/api/v1/artifacts/:id/management', async (c) => {
    await deps.service.resolveArtifact(c.req.param('id'), c.req.query('projectId'))
    return c.json({ canManage: true }, 200, { 'Cache-Control': 'private, no-store' })
  })

  app.patch('/api/v1/artifacts/:id/metadata', async (c) => {
    const body = await parseJsonBody(
      c.req.raw,
      z.object({
        title: z.string().trim().min(1).max(240),
        project: z.string().min(1).optional(),
      }),
    )
    const artifact = await deps.service.renameArtifact({
      id: c.req.param('id'),
      title: body.title,
      projectId: body.project,
    })
    return c.json({ artifact })
  })

  app.post('/api/v1/artifacts/:id/transfer', async (c) => {
    const payload = await parseJsonBody(
      c.req.raw,
      ArtifactTransferInputSchema.and(
        z.object({ author: AuthorSchema.optional().default('human:local') }),
      ),
    )
    const result = await deps.service.transferArtifact(c.req.param('id'), payload, payload.author)
    return c.json(result, payload.kind === 'copy' ? 201 : 200)
  })

  app.patch('/api/v1/artifacts/:id', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, z.union([UpdateBodySchema, ReplaceBodySchema]))
    const result = await deps.service.update({
      id,
      projectId: body.project,
      baseVersion: body.baseVersion,
      title: body.title,
      ...('source' in body ? { source: body.source } : { edits: body.edits }),
      author: body.author,
    })
    return c.json(result)
  })

  app.get('/api/v1/artifacts/:id/visual-edit', async (c) => {
    const query = VisualTargetQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new DomainError('BAD_REQUEST', '无效的源码位置或基准版本')
    const result = await deps.service.inspectVisualEdit({
      id: c.req.param('id'),
      projectId: query.data.project,
      baseVersion: query.data.baseVersion,
      loc: query.data.loc,
      boardId: query.data.boardId,
    })
    return c.json(result)
  })

  app.post('/api/v1/artifacts/:id/visual-edit/preview', async (c) => {
    const body = await parseJsonBody(c.req.raw, VisualEditBodySchema)
    const source = await deps.service.previewVisualEdit({
      ...body,
      id: c.req.param('id'),
      projectId: body.project,
    })
    return c.json({ source })
  })

  app.post('/api/v1/artifacts/:id/visual-edit', async (c) => {
    const body = await parseJsonBody(c.req.raw, VisualEditBodySchema)
    const result = await deps.service.visualEdit({
      ...body,
      id: c.req.param('id'),
      projectId: body.project,
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
    const versions =
      c.req.query('view') === 'metadata'
        ? await deps.service.getHistorySummaries(id, projectId)
        : await deps.service.getHistory(id, projectId)
    return c.json({ versions })
  })

  app.post(
    '/api/v1/artifacts/:id/storage',
    bodyLimit({
      maxSize: 128 * 1024,
      onError: () => {
        throw new DomainError('BAD_REQUEST', '制品存储请求过大')
      },
    }),
    async (c) => {
      if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '制品存储未启用')
      const id = PublicIdSchema.safeParse(c.req.param('id'))
      if (!id.success || !(await deps.artifacts.findByPublicId(id.data))) {
        throw new DomainError('NOT_FOUND', '未找到制品')
      }
      const operation = await parseJsonBody(c.req.raw, ArtifactStorageOperationSchema)
      const principal = await storagePrincipal(c.req.raw)
      const value = await executeArtifactStorage(
        deps.artifactStorage,
        id.data,
        principal,
        operation,
      )
      c.header('Cache-Control', 'no-store')
      return c.json({ value })
    },
  )

  app.get('/api/v1/artifacts/:id/storage/usage', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '制品存储未启用')
    const artifact = await deps.service.resolveArtifact(c.req.param('id'))
    const usage = await getArtifactStorageUsage(
      deps.artifactStorage,
      artifact.publicId,
      await storagePrincipal(c.req.raw),
    )
    return c.json(usage, 200, { 'Cache-Control': 'private, no-store' })
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
      audience: body.audience,
      element: body.element,
      body: body.body,
      author: body.author,
    })
    return c.json({ feedback }, 201)
  })

  app.get('/api/v1/artifacts/:id/feedback', async (c) => {
    const review = await deps.service.listFeedbackForReview({
      id: c.req.param('id'),
      projectId: c.req.query('projectId'),
      includeDrafts: c.req.query('includeDrafts') === 'true',
    })
    return c.json(review, 200, { 'Cache-Control': 'private, no-store' })
  })

  app.post('/api/v1/artifacts/:id/feedback/:feedbackId/replies', async (c) => {
    const { body, author, project, includeDrafts } = await parseJsonBody(
      c.req.raw,
      DiscussionBodySchema.extend({ body: z.string().trim().min(1).max(8000) }),
    )
    const reply = await deps.service.replyToAnnotation({
      id: c.req.param('id'),
      feedbackId: c.req.param('feedbackId'),
      projectId: project,
      author,
      includeDrafts,
      body,
    })
    return c.json({ reply }, 201)
  })

  app.post('/api/v1/artifacts/:id/feedback/:feedbackId/resolve', async (c) => {
    const { resolved, author, project, includeDrafts } = await parseJsonBody(
      c.req.raw,
      DiscussionBodySchema.extend({ resolved: z.boolean() }),
    )
    await deps.service.resolveAnnotation({
      id: c.req.param('id'),
      feedbackId: c.req.param('feedbackId'),
      projectId: project,
      author,
      includeDrafts,
      resolved,
    })
    return c.json({ ok: true })
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
        if (event.type === 'feedback.created' && !event.feedback.draft) {
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

  // 先应答再触发退出，保证响应先送达
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
