import { ArtifactPushStateInputSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import type { ArtifactService } from '../../../application/artifact-service.js'
import { DomainError } from '../../../domain/errors.js'
import { parseJsonBody } from '../request-body.js'

export function mountStateRoutes(
  app: Hono,
  service: Pick<ArtifactService, 'getStateAt' | 'pushState'>,
) {
  app.get('/api/v1/artifacts/:id/state', async (c) => {
    const id = c.req.param('id')
    const projectId = c.req.query('projectId')
    const seqParam = c.req.query('seq')
    const seq = seqParam !== undefined ? Number.parseInt(seqParam, 10) : undefined
    if (seqParam !== undefined && (!Number.isInteger(seq) || (seq ?? -1) < 0)) {
      throw new DomainError('BAD_REQUEST', 'seq 参数必须为非负整数')
    }
    const data = await service.getStateAt({ id, projectId, seq })
    return c.json(data)
  })

  app.post('/api/v1/artifacts/:id/state', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, ArtifactPushStateInputSchema.omit({ id: true }))
    const snapshot = await service.pushState({
      id,
      projectId: body.project,
      ops: body.patch,
    })
    return c.json({ publicId: snapshot.artifactId, seq: snapshot.seq, snapshot: snapshot.snapshot })
  })
}
