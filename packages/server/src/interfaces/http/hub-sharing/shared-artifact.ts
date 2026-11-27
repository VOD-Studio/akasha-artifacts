import type { Artifact } from '@akasha/protocol'
import type { Context } from 'hono'
import type { ArtifactWorkspaceRead } from '../../../application/artifact-workspace-read.js'
import type { ArtifactRepository, FeedbackRepository } from '../../../domain/ports.js'
import { fixedShareVersion, type HubShareClaim } from '../hub-auth.js'
import {
  canEditSharedArtifact,
  sharedArtifactDetail,
  visibleSharedDiscussion,
} from '../hub-share-policy.js'
import { forbidden, hidden, invalid } from './responses.js'

interface SharedRequest {
  artifact: Artifact
  grant: HubShareClaim
  suffix: string
  discussion: RegExpExecArray | null
  body?: Record<string, unknown>
  url: URL
  workspace: ArtifactWorkspaceRead
  repositories: { artifacts: ArtifactRepository; feedbacks: FeedbackRepository }
  forward(body?: Record<string, unknown>): Response | Promise<Response>
}

/** 匿名链接不借用浏览器中同时登录的账号；定向授权则保留真实批注和版本署名。 */
export function sharedAuthor(grant: HubShareClaim): string {
  return grant.boundUserId ? `human:github-${grant.boundUserId}` : 'human:share'
}

/** 以实际授权为边界转发；不转发私有状态、Agent 通道或内部评审轮次。 */
export async function serveSharedArtifact(c: Context, input: SharedRequest) {
  const { artifact, grant, suffix, body, url, repositories, workspace, forward } = input
  const fixed = fixedShareVersion(grant)
  const rawVersion = url.searchParams.get('version')
  if (fixed !== undefined && rawVersion !== null && rawVersion !== String(fixed)) return hidden(c)
  if (c.req.method === 'GET' || c.req.method === 'HEAD') {
    if (suffix === '/management') return c.json({ canManage: false })
    if (
      suffix === '/visual-edit' &&
      fixed === undefined &&
      (canEditSharedArtifact(grant) || url.searchParams.has('loc'))
    )
      return forward()
    if (suffix === '/versions') {
      if (url.searchParams.get('view') === 'metadata') {
        const versions = await repositories.artifacts.getVersionSummaries(artifact.publicId, fixed)
        return fixed === undefined || versions.length ? c.json({ versions }) : hidden(c)
      }
      const versions =
        fixed === undefined
          ? await repositories.artifacts.getVersions(artifact.publicId)
          : [await repositories.artifacts.getVersion(artifact.publicId, fixed)]
      return versions.every(Boolean) ? c.json({ versions }) : hidden(c)
    }
    if (suffix === '') {
      if (rawVersion !== null && !/^[1-9]\d*$/.test(rawVersion)) return invalid(c)
      const number = fixed ?? (rawVersion === null ? artifact.headVersion : Number(rawVersion))
      const sharedPermissions = {
        canWrite: canEditSharedArtifact(grant),
        canComment: grant.role !== 'view',
      }
      if (url.searchParams.get('view') === 'canvas') {
        const entry = await workspace.getVersion(artifact, number)
        if (!entry) return hidden(c)
        return c.json(
          {
            ...sharedArtifactDetail(artifact, entry.version, grant),
            ...sharedPermissions,
            ...(artifact.type === 'artboard' && {
              hubCanEditCanvas: rawVersion === null && canEditSharedArtifact(grant),
            }),
            ...(entry.canvas ? { canvas: entry.canvas } : {}),
          },
          200,
          { 'Cache-Control': 'private, no-store' },
        )
      }
      const version = await repositories.artifacts.getVersion(artifact.publicId, number)
      return version
        ? c.json({ ...sharedArtifactDetail(artifact, version, grant), ...sharedPermissions }, 200, {
            'Cache-Control': 'private, no-store',
          })
        : hidden(c)
    }
    if (suffix === '/boards') return forward()
    if (suffix !== '/feedback') return hidden(c)
    const { feedbacks } = repositories
    const items = (await feedbacks.listForReview(artifact.publicId, false)).filter((item) =>
      visibleSharedDiscussion(item, grant),
    )
    const threads = await feedbacks.annotations.list(artifact.publicId, false)
    return c.json({
      items: await workspace.resolveLegacyFeedback(artifact, items),
      threads: Object.fromEntries(
        items.flatMap(({ id }) => {
          const thread = threads[id]
          if (!thread) return []
          const { agent: _omitAgent, ...publicThread } = thread
          return [[id, publicThread]]
        }),
      ),
    })
  }
  if (suffix === '/favorite' && c.req.method === 'PUT' && grant.boundUserId) return forward(body)
  const author = sharedAuthor(grant)
  if (
    (c.req.method === 'PATCH' && !suffix) ||
    suffix === '/revert' ||
    suffix === '/visual-edit/preview'
  ) {
    // 视觉编辑用预览和 PATCH 持久化；内部直改接口还会产生投递给作者 Agent 的反馈。
    return canEditSharedArtifact(grant)
      ? forward({ ...body, title: undefined, author })
      : forbidden(c, grant)
  }
  if (grant.role === 'view' || (suffix !== '/feedback' && !input.discussion))
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
    return forward({ ...body, author, audience: 'human' })
  }
  let feedbackId: string
  try {
    feedbackId = decodeURIComponent(input.discussion?.[1] ?? '')
  } catch {
    return hidden(c)
  }
  const item = await repositories.feedbacks.findById(feedbackId)
  if (!item || item.artifactId !== artifact.publicId || !visibleSharedDiscussion(item, grant))
    return hidden(c)
  return forward({ ...body, includeDrafts: false, author })
}
