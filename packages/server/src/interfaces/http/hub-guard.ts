import {
  ArtifactIdentifierSchema,
  ArtifactPublishInputSchema,
  PublicIdSchema,
} from '@akasha/protocol'
import type { Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type {
  ArtifactRepository,
  Clock,
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
import { type HubAuth, type HubPrincipal, sameHubOrigin } from './hub-auth.js'

interface HubGuardOptions {
  core: Hono
  auth: HubAuth
  access: HubArtifactAccess
  repositories: { artifacts: ArtifactRepository; projects: ProjectRepository }
  origin: string
  clock: Clock
  ids: IdGenerator
}

const jsonObject = z.record(z.string(), z.unknown())
const shareInput = z.object({
  ttlSeconds: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60 * 60)
    .default(24 * 60 * 60),
})
const storageAccess = z.object({
  action: z.enum(['get', 'list', 'set', 'delete']),
  scope: z.enum(['shared', 'private']),
})
const registerProjectInput = z.object({
  id: z.string().min(1).max(256).optional(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
})
const readSuffixes: Readonly<Record<string, true>> = {
  '': true,
  '/versions': true,
  '/state': true,
  '/visual-edit': true,
  '/edits': true,
}
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
const artifactPath = /^\/api\/v1\/artifacts\/([^/]+)(.*)$/

function hidden(c: Context) {
  return c.json({ error: { code: 'NOT_FOUND', message: '未找到请求的资源' } }, 404)
}

function forbidden(c: Context, principal?: HubPrincipal) {
  return principal
    ? c.json({ error: { code: 'FORBIDDEN', message: '当前账号没有此操作的权限' } }, 403)
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

function rewrite(request: Request, url: URL, body?: Record<string, unknown>) {
  if (body === undefined) return request.url === url.href ? request : new Request(url, request)
  const headers = new Headers(request.headers)
  headers.delete('content-length')
  return new Request(url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  })
}

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
      if (!principal?.member) return forbidden(c, principal)
      const body = ArtifactPublishInputSchema.safeParse(await readJson(request))
      if (!body.success) return invalid(c)
      const project = body.data.project ?? defaultProject
      if (!project) return invalid(c)
      const existing = await repositories.artifacts.findBySlug(project, body.data.slug)
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
        if (role === 'none') return hidden(c)
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
    if (
      read
        ? !Object.hasOwn(readSuffixes, suffix)
        : !(method === 'PATCH' && suffix === '') &&
          !(
            method === 'POST' &&
            (writeMode || roundAction.test(suffix) || suffix === '/share' || suffix === '/storage')
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
    const role = await access.role(request, artifact, principal)
    if (role === 'none') return hidden(c)
    const writer = role === 'owner' || role === 'editor'
    url.pathname = `/api/v1/artifacts/${artifact.publicId}${suffix}`

    if (suffix === '/share') {
      if (role !== 'owner') return forbidden(c, principal)
      const parsed = shareInput.safeParse(body)
      return parsed.success
        ? c.json(await auth.createShare(artifact.publicId, parsed.data.ttlSeconds), 201)
        : invalid(c)
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
      const response = await core.fetch(rewrite(request, url))
      return role === 'owner' ||
        (await access.authorizeArtifact(request, artifact.publicId, 'read'))
        ? response
        : hidden(c)
    }
    if (suffix === '/feedback') {
      if (!principal && role !== 'share') return forbidden(c)
      return core.fetch(
        rewrite(request, url, {
          ...body,
          author: principal ? hubAuthor(principal) : 'human:share',
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
