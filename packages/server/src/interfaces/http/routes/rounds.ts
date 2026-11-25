import { ArtifactRecordVerdictInputSchema, ReviewGroupSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import { parseJsonBody } from '../request-body.js'

const OpenRoundBodySchema = z.object({
  project: z.string().min(1).optional(),
  groups: z.array(ReviewGroupSchema).min(1),
})

export function mountReviewRoundRoutes(
  app: Hono,
  service: Pick<ArtifactService, 'openRound' | 'recordDecision' | 'submitRound' | 'withdrawRound'>,
) {
  app.post('/api/v1/artifacts/:id/rounds', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, OpenRoundBodySchema)
    const round = await service.openRound({
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
    const round = await service.submitRound({ id, projectId, roundId })
    return c.json({ round })
  })

  app.post('/api/v1/artifacts/:id/rounds/:roundId/withdraw', async (c) => {
    const id = c.req.param('id')
    const roundId = c.req.param('roundId')
    const projectId = c.req.query('projectId')
    const round = await service.withdrawRound({ id, projectId, roundId })
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
    const round = await service.recordDecision({
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
}
