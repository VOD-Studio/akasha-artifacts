import {
  ArtifactAckFeedbackInputSchema,
  ArtifactAwaitFeedbackInputSchema,
  AuthorSchema,
  ElementRefSchema,
  FeedbackKindSchema,
  FeedbackSchema,
} from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import type { RealtimeSubscriber } from '../../../domain/ports.js'
import { parseJsonBody } from '../request-body.js'

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

interface FeedbackRoutes {
  service: Pick<
    ArtifactService,
    | 'ackFeedback'
    | 'listFeedbackForReview'
    | 'pullFeedback'
    | 'replyToAnnotation'
    | 'resolveAnnotation'
    | 'resolveArtifact'
    | 'submitFeedback'
  >
  realtime: Pick<RealtimeSubscriber, 'subscribe'>
}

export function mountFeedbackRoutes(app: Hono, deps: FeedbackRoutes) {
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
}
