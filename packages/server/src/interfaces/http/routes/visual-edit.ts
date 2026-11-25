import { AuthorSchema, EditOpSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import { DomainError } from '../../../domain/errors.js'
import { parseJsonBody } from '../request-body.js'

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

export function mountVisualEditRoutes(
  app: Hono,
  service: Pick<ArtifactService, 'inspectVisualEdit' | 'previewVisualEdit' | 'visualEdit'>,
) {
  app.get('/api/v1/artifacts/:id/visual-edit', async (c) => {
    const query = VisualTargetQuerySchema.safeParse(c.req.query())
    if (!query.success) throw new DomainError('BAD_REQUEST', '无效的源码位置或基准版本')
    const result = await service.inspectVisualEdit({
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
    const source = await service.previewVisualEdit({
      ...body,
      id: c.req.param('id'),
      projectId: body.project,
    })
    return c.json({ source })
  })

  app.post('/api/v1/artifacts/:id/visual-edit', async (c) => {
    const body = await parseJsonBody(c.req.raw, VisualEditBodySchema)
    const result = await service.visualEdit({
      ...body,
      id: c.req.param('id'),
      projectId: body.project,
    })
    return c.json(result)
  })
}
