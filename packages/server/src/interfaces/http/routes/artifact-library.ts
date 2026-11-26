import { type Artifact, ArtifactTransferInputSchema, AuthorSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import { DomainError } from '../../../domain/errors.js'
import type { ArtifactRepository } from '../../../domain/ports.js'
import { hasLocalWriteAuth } from '../daemon-guard.js'
import type { HttpSecurityConfig } from '../dependencies.js'
import { parseJsonBody } from '../request-body.js'

interface LibraryRoutes {
  service: Pick<
    ArtifactService,
    | 'getArtifact'
    | 'getWorkspace'
    | 'workspace'
    | 'getHistory'
    | 'getHistorySummaries'
    | 'renameArtifact'
    | 'resolveArtifact'
    | 'setArtifactWithdrawal'
    | 'transferArtifact'
  >
  artifacts: Pick<ArtifactRepository, 'lifecycle' | 'listByProject'>
  security?: HttpSecurityConfig
}

export function mountArtifactLibraryRoutes(
  app: Hono,
  deps: LibraryRoutes,
  forgetSelection: (artifact: Artifact) => void,
) {
  app.get('/api/v1/artifacts', async (c) => {
    const projectId = c.req.query('projectId')
    const artifacts = await deps.artifacts.listByProject(projectId)
    return c.json({ artifacts })
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
    const canWrite = hasLocalWriteAuth(c.req.raw, deps.security)
    const permissions = { canWrite, canComment: canWrite }
    if (c.req.query('view') === 'canvas') {
      return c.json({ ...(await deps.service.getWorkspace(input)), ...permissions }, 200, {
        'Cache-Control': 'private, no-store',
      })
    }
    return c.json({ ...(await deps.service.getArtifact(input)), ...permissions }, 200, {
      'Cache-Control': 'private, no-store',
    })
  })

  app.get('/api/v1/artifacts/:id/boards', async (c) => {
    const rawVersion = c.req.query('version')
    const version = Number(rawVersion)
    if (!rawVersion || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(version)) {
      throw new DomainError('BAD_REQUEST', '读取画板必须指定正整数版本号')
    }
    const boardId = c.req.query('boardId')
    if (!boardId) throw new DomainError('BAD_REQUEST', '读取画板必须指定画板标识')
    const artifact = await deps.service.resolveArtifact(c.req.param('id'), c.req.query('projectId'))
    const board = await deps.service.workspace.getBoard(artifact, version, boardId)
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
    forgetSelection(artifact)
    return c.json({ artifact })
  })

  app.post('/api/v1/artifacts/:id/restore', async (c) => {
    const artifact = await deps.service.setArtifactWithdrawal(c.req.param('id'), false)
    return c.json({ artifact })
  })

  app.get('/api/v1/artifacts/:id/management', async (c) => {
    await deps.service.resolveArtifact(c.req.param('id'), c.req.query('projectId'))
    return c.json({ canManage: hasLocalWriteAuth(c.req.raw, deps.security) }, 200, {
      'Cache-Control': 'private, no-store',
    })
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

  app.get('/api/v1/artifacts/:id/versions', async (c) => {
    const id = c.req.param('id')
    const projectId = c.req.query('projectId')
    const versions =
      c.req.query('view') === 'metadata'
        ? await deps.service.getHistorySummaries(id, projectId)
        : await deps.service.getHistory(id, projectId)
    return c.json({ versions })
  })
}
