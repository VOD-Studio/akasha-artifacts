import {
  ArtifactCheckInputSchema,
  ArtifactPublishInputSchema,
  ArtifactTypeSchema,
  ArtifactUpdateInputSchema,
  AuthorSchema,
} from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import type { CheckService } from '../../../application/check-service.js'
import type { SpecRegistry } from '../../../application/spec-registry.js'
import { DomainError } from '../../../domain/errors.js'
import { parseJsonBody } from '../request-body.js'

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

interface AuthoringRoutes {
  service: Pick<ArtifactService, 'publish' | 'update' | 'revert'>
  checks: Pick<CheckService, 'check'>
  specs: Pick<SpecRegistry, 'getSpec'>
}

export function mountAuthoringRoutes(app: Hono, deps: AuthoringRoutes) {
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
}
