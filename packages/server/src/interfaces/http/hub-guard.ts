import {
  ArtifactIdentifierSchema,
  ArtifactPublishInputSchema,
  ArtifactShareInputSchema,
  ArtifactTransferInputSchema,
  PublicIdSchema,
} from '@akasha/protocol'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { ArtifactWorkspaceRead } from '../../application/artifact-workspace-read.js'
import type { SystemCatalog } from '../../application/design-systems/catalog.js'
import type { HubSharing } from '../../application/hub-sharing/service.js'
import type { HubSharingRepository } from '../../domain/hub-sharing.js'
import type {
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  ProjectRepository,
} from '../../domain/ports.js'
import {
  type HubArtifactAccess,
  hubAuthor,
  hubProjectPrefix,
  ownsHubProject,
} from './hub-access.js'
import { type HubAuth, sameHubOrigin } from './hub-auth.js'
import { canEditSharedArtifact, matchesShareBoard } from './hub-share-policy.js'
import { forbidden, hidden, invalid } from './hub-sharing/responses.js'
import { mountHubSharing } from './hub-sharing/routes.js'
import { serveSharedArtifact, sharedAuthor } from './hub-sharing/shared-artifact.js'
import { mountSystemCatalog } from './system-catalog.js'

interface HubGuardOptions {
  core: Hono
  auth: HubAuth
  access: HubArtifactAccess
  sharing: HubSharing
  catalog: SystemCatalog
  workspace: ArtifactWorkspaceRead
  repositories: {
    artifacts: ArtifactRepository
    projects: ProjectRepository
    feedbacks: FeedbackRepository
    sharing: HubSharingRepository
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
  '/boards': true,
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
  {
    core,
    auth,
    access,
    sharing,
    catalog,
    workspace,
    repositories,
    origin,
    clock,
    ids,
  }: HubGuardOptions,
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
  mountHubSharing(app, { auth, artifacts: repositories.artifacts, sharing })
  mountSystemCatalog(app, auth, catalog, repositories.projects)
  app.post('/api/v1/artifacts/:id/storage', bodyLimit({ maxSize: 128 * 1024, onError: invalid }))
  app.post(
    '/api/v1/projects/:id/design-systems/*',
    bodyLimit({ maxSize: 24 * 1024 * 1024, onError: invalid }),
  )

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
    const coding =
      /^\/api\/v1\/projects\/([^/]+)\/coding-sessions(?:\/(targets)|\/[a-f0-9-]{36}\/(read|poll|publish|bind|workspace|workspace-publish))?$/.exec(
        path,
      )
    if (coding && method === 'POST') {
      const action = coding[2] ?? coding[3]
      if (action === 'read' || action === 'poll' || action === 'publish') return core.fetch(request)
      if (!principal || !ownsHubProject(principal, decodeSegment(coding[1])))
        return forbidden(c, principal)
      if (action)
        return principal.kind === 'session' ? core.fetch(request) : forbidden(c, principal)
      if (principal.kind !== 'cli') return forbidden(c, principal)
      const forwarded = new Request(request)
      forwarded.headers.set('x-akasha-cli-expiry', String(auth.cliExpiry(principal)))
      return core.fetch(forwarded)
    }

    if (path === '/api/v1/withdrawn-artifacts' && read) {
      if (principal?.kind !== 'session' || !principal.member) return forbidden(c, principal)
      const items = (await repositories.artifacts.lifecycle.listWithdrawn()).filter(
        ({ artifact }) => ownsHubProject(principal, artifact.projectId),
      )
      return c.json({ items })
    }

    const coreFeedback = async (scope: string, body?: Record<string, unknown>) => {
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

    const designSystem =
      /^\/api\/v1\/projects\/([^/]+)\/design-systems\/(preview|publish|generate)$/.exec(path)
    if (designSystem) {
      if (
        method !== 'POST' ||
        !principal ||
        !ownsHubProject(principal, decodeSegment(designSystem[1]))
      ) {
        return hidden(c)
      }
      if (designSystem[2] === 'preview') return core.fetch(request)
      const body = await readJson(request)
      if (!body) return invalid(c)
      if (
        designSystem[2] === 'generate' &&
        typeof body.id === 'string' &&
        typeof body.version === 'number'
      ) {
        const pin = await catalog.pin(decodeSegment(designSystem[1]), body.id, body.version)
        if (pin && (await catalog.members.publication(pin))?.withdrawn) return hidden(c)
      }
      return core.fetch(rewrite(request, url, { ...body, author: hubAuthor(principal) }))
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
        return c.json({ artifacts: await access.listVisible(artifacts, principal) })
      }
      if (method !== 'POST') return hidden(c)
      const body = ArtifactPublishInputSchema.safeParse(await readJson(request))
      if (!body.success) return invalid(c)
      const project = body.data.project ?? defaultProject
      if (!project) return principal ? invalid(c) : forbidden(c)
      const existing = await repositories.artifacts.findBySlug(project, body.data.slug)
      const decision = existing && (await access.decide(request, existing, principal))
      const grant = decision?.grant
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
              author: sharedAuthor(grant),
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
      const role = decision?.role
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
        const { role } = await access.decide(request, artifact, principal)
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
      if (!artifact || !ownsHubProject(principal, artifact.projectId)) return hidden(c)
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
        if (!artifact || !ownsHubProject(principal, artifact.projectId)) return hidden(c)
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
    if (method === 'POST' && suffix === '/restore') {
      if (principal?.kind !== 'session' || !PublicIdSchema.safeParse(id).success) return hidden(c)
      const item = await repositories.artifacts.lifecycle.findWithdrawn(id)
      if (!item || !ownsHubProject(principal, item.artifact.projectId)) return hidden(c)
      return core.fetch(rewrite(request, url))
    }
    const writeMode = writeSuffixes[suffix]
    const discussion = discussionAction.exec(suffix)
    if (
      read
        ? !Object.hasOwn(readSuffixes, suffix)
        : !(method === 'PATCH' && (suffix === '' || suffix === '/metadata')) &&
          !(method === 'DELETE' && suffix === '') &&
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
    const acceptsBody = !read && method !== 'DELETE' && !roundAction.test(suffix)
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
    const { grant, role } = await access.decide(request, artifact, principal)
    if (role === 'none') return hidden(c)
    const writer = role === 'owner' || role === 'editor'
    url.pathname = `/api/v1/artifacts/${artifact.publicId}${suffix}`

    if (grant) {
      return serveSharedArtifact(c, {
        artifact,
        grant,
        suffix,
        discussion,
        body,
        url,
        workspace,
        repositories,
        forward: (data) => core.fetch(rewrite(request, url, data)),
      })
    }

    const canManage = role === 'owner' && principal?.kind === 'session'
    if (method === 'DELETE')
      return canManage ? core.fetch(rewrite(request, url)) : forbidden(c, principal)
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
      const signed = await auth.createShare(artifact.publicId, parsed.data)
      return signed ? c.json(signed, 201) : forbidden(c, principal)
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
      if (
        role === 'owner' &&
        !suffix &&
        method === 'GET' &&
        response.ok &&
        (await repositories.sharing.getScope(artifact.publicId)).restricted
      )
        return c.json({ ...jsonObject.parse(await response.json()), hubRestricted: true })
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
