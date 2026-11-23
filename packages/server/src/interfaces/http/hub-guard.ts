import {
  ArtifactIdentifierSchema,
  ArtifactPublishInputSchema,
  ArtifactShareInputSchema,
  ArtifactTransferInputSchema,
  PublicIdSchema,
} from '@akasha/protocol'
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type {
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  ProjectRepository,
} from '../../domain/ports.js'
import {
  baseArtifactRole,
  type HubArtifactAccess,
  hubAuthor,
  hubProjectPrefix,
  ownsHubProject,
} from './hub-access.js'
import {
  fixedShareVersion,
  type HubAuth,
  type HubPrincipal,
  type HubShareClaim,
  sameHubOrigin,
} from './hub-auth.js'
import {
  canEditSharedArtifact,
  matchesShareBoard,
  sharedArtifactDetail,
  visibleSharedDiscussion,
} from './hub-share-policy.js'

interface HubGuardOptions {
  core: Hono
  auth: HubAuth
  access: HubArtifactAccess
  repositories: {
    artifacts: ArtifactRepository
    projects: ProjectRepository
    feedbacks: FeedbackRepository
  }
  origin: string
  clock: Clock
  ids: IdGenerator
}

const jsonObject = z.record(z.string(), z.unknown())
const storageAccess = z.object({
  action: z.enum(['get', 'list', 'set', 'delete']),
  scope: z.enum(['shared', 'private']),
})
const registerProjectInput = z.object({
  id: z.string().min(1).max(256).optional(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
})
// 允许转发到 core 的读路径后缀；空串即制品详情
const readSuffixes: Readonly<Record<string, true>> = {
  '': true,
  '/versions': true,
  '/state': true,
  '/visual-edit': true,
  '/edits': true,
  '/feedback': true,
  '/management': true,
  '/storage/usage': true,
}
// 允许转发到 core 的写路径后缀；authored 表示强制以调用方身份作为作者
const writeSuffixes: Readonly<Record<string, 'write' | 'authored'>> = {
  '/state': 'write',
  '/rounds': 'write',
  '/verdict': 'write',
  '/feedback': 'authored',
  '/revert': 'authored',
  '/visual-edit': 'authored',
  '/visual-edit/preview': 'authored',
  '/edits': 'authored',
  '/edits/preview': 'authored',
}
const roundAction = /^\/rounds\/[^/]+\/(?:submit|withdraw)$/
const discussionAction = /^\/feedback\/([^/]+)\/(?:replies|resolve)$/
const artifactPath = /^\/api\/v1\/artifacts\/([^/]+)(.*)$/

// 无权访问与不存在统一返回 404，不泄露制品是否存在
function hidden(c: Context) {
  return c.json({ error: { code: 'NOT_FOUND', message: '未找到请求的资源' } }, 404)
}

function forbidden(c: Context, access?: HubPrincipal | HubShareClaim) {
  return access
    ? c.json({ error: { code: 'FORBIDDEN', message: '当前权限不允许此操作' } }, 403)
    : c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录 Hub' } }, 401)
}

function invalid(c: Context) {
  return c.json({ error: { code: 'BAD_REQUEST', message: '请求参数无效' } }, 400)
}
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

async function readJson(request: Request) {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/json'
  )
    return
  const parsed = jsonObject.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null),
  )
  if (parsed.success) return parsed.data
}

function rewrite(
  request: Request,
  url: URL,
  body?: Record<string, unknown>,
  method = request.method,
) {
  if (body === undefined) return request.url === url.href ? request : new Request(url, request)
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return new Request(url, {
    method,
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

/**
 * 在通用接口外层挂载 Hub 守卫：同源校验、鉴权、按角色的访问控制与回执封装。
 *
 * @remarks 默认拒绝：只有显式列出的路径会转发到 `core`，新增的 core 路由不会自动在 Hub 暴露。
 */
export function mountHubGuard(
  app: Hono,
  { core, auth, access, repositories, origin, clock, ids }: HubGuardOptions,
) {
  app.use('*', async (c, next) => {
    if (
      (c.req.path.startsWith('/api/') || c.req.method !== 'GET' || c.req.header('upgrade')) &&
      !sameHubOrigin(c.req.raw, origin)
    ) {
      return c.json({ error: { code: 'FORBIDDEN', message: '拒绝跨站请求' } }, 403)
    }
    c.header('Cache-Control', 'private, no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    await next()
  })
  auth.mount(app)
  app.post('/api/v1/artifacts/:id/storage', bodyLimit({ maxSize: 128 * 1024, onError: invalid }))

  // 仅转发显式授权的路径；新增 core 路由默认不会在 Hub 暴露。
  app.use('/api/v1/*', async (c, next) => {
    const request = c.req.raw
    const url = new URL(request.url)
    const path = url.pathname
    const method = c.req.method
    const read = method === 'GET' || method === 'HEAD'
    if (path === '/api/v1/ws' && read) return next()
    if (
      (read &&
        (path === '/api/v1/health' ||
          path === '/api/v1/daemon/status' ||
          /^\/api\/v1\/specs\/[^/]+$/.test(path))) ||
      (method === 'POST' && path === '/api/v1/artifacts/check')
    ) {
      return core.fetch(request)
    }
    const principal = await auth.authenticate(request)
    const defaultProject = principal ? `${hubProjectPrefix(principal)}default` : undefined
    const projectQuery = url.searchParams.get('projectId') ?? undefined

    async function coreFeedback(scope: string, body?: Record<string, unknown>) {
      const response = await core.fetch(rewrite(request, url, body))
      if (!response.ok || request.method === 'HEAD') return response
      const payload = jsonObject.parse(await response.json())
      if (typeof payload.receipt === 'string') {
        if (principal?.member)
          payload.receipt = await auth.sealReceipt(principal, scope, payload.receipt)
        else delete payload.receipt
      }
      return c.json(payload)
    }

    if (path === '/api/v1/favorites' && read) {
      return principal?.kind === 'session' ? core.fetch(request) : forbidden(c, principal)
    }

    if (path === '/api/v1/projects') {
      if (read) {
        if (!principal?.member) return c.json({ projects: [] })
        const prefix = hubProjectPrefix(principal)
        const projects = (await repositories.projects.list()).filter((project) =>
          ownsHubProject(principal, project.id),
        )
        return c.json({
          projects: projects.map((project) => ({
            ...project,
            rootPath: project.rootPath.slice(prefix.length),
            dormant:
              Date.parse(clock.now()) - Date.parse(project.lastActiveAt) > 7 * 24 * 60 * 60 * 1000,
          })),
        })
      }
      if (method !== 'POST') return hidden(c)
      if (!principal?.member) return forbidden(c, principal)
      const body = registerProjectInput.safeParse(await readJson(request))
      if (!body.success) return invalid(c)
      const prefix = hubProjectPrefix(principal)
      const id = body.data.id ?? ids.id('proj')
      const response = await core.fetch(
        rewrite(request, url, {
          ...body.data,
          id: id.startsWith(prefix) ? id : `${prefix}${id}`,
          rootPath: `${prefix}${body.data.rootPath}`,
        }),
      )
      if (!response.ok) return response
      const payload = z
        .object({ project: z.looseObject({ rootPath: z.string() }) })
        .parse(await response.json())
      return c.json(
        {
          project: { ...payload.project, rootPath: payload.project.rootPath.slice(prefix.length) },
        },
        201,
      )
    }

    const projectPath = /^\/api\/v1\/projects\/([^/]+)(\/selection)?$/.exec(path)
    if (projectPath?.[1]) {
      const projectId = decodeSegment(projectPath[1])
      if (!ownsHubProject(principal, projectId)) return hidden(c)
      if (!projectPath[2]) return method === 'DELETE' ? core.fetch(request) : hidden(c)
      if (read) return core.fetch(request)
      if (method !== 'POST') return hidden(c)
      const body = await readJson(request)
      if (!body) return invalid(c)
      if (typeof body.artifactId === 'string') {
        if (!PublicIdSchema.safeParse(body.artifactId).success) return invalid(c)
        const artifact = await repositories.artifacts.findByPublicId(body.artifactId)
        if (!artifact || artifact.projectId !== projectId) return hidden(c)
      }
      return core.fetch(request)
    }

    if (path === '/api/v1/artifacts') {
      if (read) {
        const artifacts = await repositories.artifacts.listByProject(projectQuery)
        return c.json({
          artifacts: artifacts.filter(
            (artifact) => baseArtifactRole(artifact, principal) !== 'none',
          ),
        })
      }
      if (method !== 'POST') return hidden(c)
      const body = ArtifactPublishInputSchema.safeParse(await readJson(request))
      if (!body.success) return invalid(c)
      const project = body.data.project ?? defaultProject
      if (!project) return principal ? invalid(c) : forbidden(c)
      const existing = await repositories.artifacts.findBySlug(project, body.data.slug)
      const grant = existing && (await access.share(request, existing, principal))
      if (grant && existing) {
        if (
          !canEditSharedArtifact(grant) ||
          (body.data.visibility !== undefined && body.data.visibility !== existing.visibility) ||
          body.data.type !== existing.type
        )
          return forbidden(c, grant)
        if (body.data.baseVersion === undefined) return invalid(c)
        // 只有已授权的制品可以更新；锁定 publicId，不能借发布入口创建或覆盖其他制品。
        url.pathname = `/api/v1/artifacts/${existing.publicId}`
        return core.fetch(
          rewrite(
            request,
            url,
            {
              baseVersion: body.data.baseVersion,
              source: body.data.source,
              author: 'human:share',
            },
            'PATCH',
          ),
        )
      }
      if (!principal?.member) return forbidden(c, principal)
      const publish = { ...body.data, project, author: hubAuthor(principal) }
      if (!existing)
        return ownsHubProject(principal, project)
          ? core.fetch(rewrite(request, url, publish))
          : hidden(c)
      const role = baseArtifactRole(existing, principal)
      if (role === 'owner') return core.fetch(rewrite(request, url, publish))
      if (role !== 'editor') return hidden(c)
      if (publish.visibility !== undefined && publish.visibility !== existing.visibility)
        return forbidden(c, principal)
      if (publish.baseVersion === undefined) return invalid(c)
      // 协作者可以提交新版本，但不能更改可见性；权限在响应返回冲突详情前重新校验。
      const response = await core.fetch(
        rewrite(request, url, { ...publish, visibility: undefined }),
      )
      return (await access.authorizeArtifact(request, existing.publicId, 'write'))
        ? response
        : hidden(c)
    }

    if (path === '/api/v1/feedback' && read) {
      const id = url.searchParams.get('id')
      if (id) {
        const artifact = await access.resolve(id, projectQuery, principal)
        if (!artifact) return hidden(c)
        const role = await access.role(request, artifact, principal)
        if (role === 'none' || role === 'share') return hidden(c)
        url.searchParams.set('id', artifact.publicId)
        if (role !== 'owner' && role !== 'editor') url.searchParams.set('includeDrafts', 'false')
        if (role !== 'owner') url.searchParams.set('detail', 'false')
        const response = await coreFeedback(artifact.publicId)
        return role === 'owner' ||
          (await access.authorizeArtifact(
            request,
            artifact.publicId,
            role === 'editor' ? 'write' : 'read',
          ))
          ? response
          : hidden(c)
      }
      const projectId = projectQuery ?? defaultProject
      if (!projectId || !ownsHubProject(principal, projectId)) return forbidden(c, principal)
      url.searchParams.set('projectId', projectId)
      return coreFeedback(`project:${projectId}`)
    }

    if (path === '/api/v1/feedback/await' && method === 'POST') {
      if (!principal?.member) return forbidden(c, principal)
      const body = await readJson(request)
      if (!body || typeof body.id !== 'string') return invalid(c)
      const artifact = await access.resolve(
        body.id,
        typeof body.project === 'string' ? body.project : undefined,
        principal,
      )
      if (!artifact || baseArtifactRole(artifact, principal) !== 'owner') return hidden(c)
      return coreFeedback(artifact.publicId, { ...body, id: artifact.publicId })
    }

    if (path === '/api/v1/feedback/ack' && method === 'POST') {
      if (!principal?.member) return forbidden(c, principal)
      const body = await readJson(request)
      if (!body || typeof body.receipt !== 'string') return invalid(c)
      const signed = await auth.openReceipt(body.receipt, principal)
      if (!signed)
        return c.json({ error: { code: 'INVALID_RECEIPT', message: '反馈回执无效或已过期' } }, 400)
      if (signed.artifactId.startsWith('project:')) {
        if (!ownsHubProject(principal, signed.artifactId.slice('project:'.length))) return hidden(c)
      } else {
        const artifact = await repositories.artifacts.findByPublicId(signed.artifactId)
        if (!artifact || baseArtifactRole(artifact, principal) !== 'owner') return hidden(c)
      }
      return core.fetch(rewrite(request, url, { ...body, receipt: signed.receipt }))
    }

    if (path === '/api/v1/agent/activity' && method === 'POST') {
      if (!principal?.member) return forbidden(c, principal)
      const body = await readJson(request)
      if (!body || typeof body.projectId !== 'string') return invalid(c)
      if (!ownsHubProject(principal, body.projectId)) return hidden(c)
      if (typeof body.artifactId === 'string') {
        if (!PublicIdSchema.safeParse(body.artifactId).success) return invalid(c)
        const artifact = await repositories.artifacts.findByPublicId(body.artifactId)
        if (!artifact || artifact.projectId !== body.projectId) return hidden(c)
      }
      return core.fetch(request)
    }

    const match = artifactPath.exec(path)
    if (!match?.[1] || match[2] === undefined) return hidden(c)
    const id = decodeSegment(match[1])
    const suffix = match[2]
    if (!ArtifactIdentifierSchema.safeParse(id).success) return hidden(c)
    const writeMode = writeSuffixes[suffix]
    const discussion = discussionAction.exec(suffix)
    if (
      read
        ? !Object.hasOwn(readSuffixes, suffix)
        : !(method === 'PATCH' && (suffix === '' || suffix === '/metadata')) &&
          !(method === 'PUT' && suffix === '/favorite') &&
          !(
            method === 'POST' &&
            (writeMode ||
              discussion ||
              roundAction.test(suffix) ||
              suffix === '/share' ||
              suffix === '/transfer' ||
              suffix === '/storage')
          )
    )
      return hidden(c)
    const acceptsBody = !read && !roundAction.test(suffix)
    const body = acceptsBody ? await readJson(request) : undefined
    if (acceptsBody && !body) return invalid(c)
    const project = typeof body?.project === 'string' ? body.project : projectQuery
    // 公共 ID 是唯一授权对象，转发时固定到该 ID，不让 core 重新按别名选择不同的制品。
    const artifact =
      suffix === '/storage'
        ? PublicIdSchema.safeParse(id).success
          ? await repositories.artifacts.findByPublicId(id)
          : undefined
        : await access.resolve(id, project, principal)
    if (!artifact) return hidden(c)
    const grant = await access.share(request, artifact, principal)
    const role = grant ? 'share' : baseArtifactRole(artifact, principal)
    if (role === 'none') return hidden(c)
    const writer = role === 'owner' || role === 'editor'
    url.pathname = `/api/v1/artifacts/${artifact.publicId}${suffix}`

    if (grant) {
      const fixed = fixedShareVersion(grant)
      const rawVersion = url.searchParams.get('version')
      if (fixed !== undefined && rawVersion !== null && rawVersion !== String(fixed))
        return hidden(c)
      if (read) {
        if (suffix === '/management') return c.json({ canManage: false })
        if (suffix === '/visual-edit' && canEditSharedArtifact(grant))
          return core.fetch(rewrite(request, url))
        if (suffix === '/versions') {
          const versions =
            fixed === undefined
              ? await repositories.artifacts.getVersions(artifact.publicId)
              : [await repositories.artifacts.getVersion(artifact.publicId, fixed)]
          return versions.every(Boolean) ? c.json({ versions }) : hidden(c)
        }
        if (suffix === '') {
          if (rawVersion !== null && !/^[1-9]\d*$/.test(rawVersion)) return invalid(c)
          const number = fixed ?? (rawVersion === null ? artifact.headVersion : Number(rawVersion))
          const version = await repositories.artifacts.getVersion(artifact.publicId, number)
          return version ? c.json(sharedArtifactDetail(artifact, version, grant)) : hidden(c)
        }
        if (suffix !== '/feedback') return hidden(c)
        const feedbacks = repositories.feedbacks
        const items = (await feedbacks.listForReview(artifact.publicId, false)).filter((item) =>
          visibleSharedDiscussion(item, grant),
        )
        const threads = await feedbacks.annotations.list(artifact.publicId, false)
        return c.json({
          items,
          threads: Object.fromEntries(
            items.flatMap(({ id }) => (threads[id] ? [[id, threads[id]]] : [])),
          ),
        })
      }
      if (
        (method === 'PATCH' && !suffix) ||
        suffix === '/revert' ||
        suffix === '/visual-edit/preview'
      ) {
        return canEditSharedArtifact(grant)
          ? core.fetch(rewrite(request, url, { ...body, title: undefined, author: 'human:share' }))
          : forbidden(c, grant)
      }
      if (grant.role === 'view' || (suffix !== '/feedback' && !discussion))
        return forbidden(c, grant)
      if (suffix === '/feedback') {
        if (fixed !== undefined && body?.version !== fixed) return hidden(c)
        if (
          body?.kind !== 'comment' ||
          body.audience === 'agent' ||
          body.roundId != null ||
          body.groupId != null
        )
          return forbidden(c, grant)
        return core.fetch(
          rewrite(request, url, { ...body, author: 'human:share', audience: 'human' }),
        )
      }
      const item = discussion?.[1]
        ? await repositories.feedbacks.findById(decodeSegment(discussion[1]))
        : undefined
      if (!item || item.artifactId !== artifact.publicId || !visibleSharedDiscussion(item, grant))
        return hidden(c)
      return core.fetch(
        rewrite(request, url, { ...body, includeDrafts: false, author: 'human:share' }),
      )
    }

    const canManage = role === 'owner' && principal?.kind === 'session'
    if (suffix === '/management') return c.json({ canManage })
    if (suffix === '/metadata') {
      return canManage ? core.fetch(rewrite(request, url, body)) : forbidden(c, principal)
    }
    if (suffix === '/transfer') {
      if (!canManage || !principal) return forbidden(c, principal)
      const parsed = ArtifactTransferInputSchema.safeParse(body)
      if (!parsed.success) return invalid(c)
      // 同属一个账户命名空间才保留旧分享角色与制品可见性。
      if (!ownsHubProject(principal, parsed.data.targetProjectId)) return forbidden(c, principal)
      return core.fetch(rewrite(request, url, { ...parsed.data, author: hubAuthor(principal) }))
    }
    if (suffix === '/favorite') {
      return principal?.kind === 'session'
        ? core.fetch(rewrite(request, url, body))
        : forbidden(c, principal)
    }
    if (suffix === '/storage/usage') {
      return canManage ? core.fetch(rewrite(request, url)) : forbidden(c, principal)
    }

    if (suffix === '/share') {
      if (!canManage) return forbidden(c, principal)
      const parsed = ArtifactShareInputSchema.safeParse(body)
      if (!parsed.success) return invalid(c)
      const { entry } = parsed.data
      if (entry.kind !== 'artifact') {
        const version = await repositories.artifacts.getVersion(artifact.publicId, entry.version)
        if (!version || (entry.kind === 'play' && !matchesShareBoard(artifact, version, entry)))
          return hidden(c)
      }
      return c.json(await auth.createShare(artifact.publicId, parsed.data), 201)
    }
    if (suffix === '/storage') {
      const operation = storageAccess.safeParse(body)
      if (!operation.success) return invalid(c)
      const { scope, action } = operation.data
      if (
        (scope === 'private' && !principal) ||
        (scope === 'shared' && (action === 'set' || action === 'delete') && !writer)
      )
        return forbidden(c, principal)
      return core.fetch(rewrite(request, url))
    }
    if (read) {
      if (suffix === '/feedback') {
        if (principal?.kind === 'cli') return forbidden(c, principal)
        if (!writer) url.searchParams.set('includeDrafts', 'false')
      }
      const response = await core.fetch(rewrite(request, url))
      return role === 'owner' ||
        (await access.authorizeArtifact(request, artifact.publicId, 'read'))
        ? response
        : hidden(c)
    }
    if (suffix === '/feedback' || discussion) {
      if (!principal || (discussion && principal.kind === 'cli')) return forbidden(c, principal)
      return core.fetch(
        rewrite(request, url, {
          ...body,
          author: hubAuthor(principal),
          ...(discussion && { includeDrafts: writer }),
        }),
      )
    }
    if (!writer || !principal) return forbidden(c, principal)
    if (suffix === '/verdict')
      return core.fetch(rewrite(request, url, { ...body, fromAgent: principal.kind === 'cli' }))
    return core.fetch(
      rewrite(
        request,
        url,
        method === 'PATCH' || writeMode === 'authored'
          ? { ...body, author: hubAuthor(principal) }
          : undefined,
      ),
    )
  })
}
