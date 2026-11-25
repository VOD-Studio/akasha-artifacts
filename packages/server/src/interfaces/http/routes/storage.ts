import { ArtifactStorageOperationSchema, PublicIdSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  listArtifactFavorites,
  setArtifactFavorite,
} from '../../../application/artifact-favorites.js'
import type { ArtifactService } from '../../../application/artifact-service.js'
import {
  executeArtifactStorage,
  getArtifactStorageUsage,
} from '../../../application/artifact-storage.js'
import { DomainError } from '../../../domain/errors.js'
import type { ArtifactRepository } from '../../../domain/ports.js'
import type { HttpAppDeps } from '../dependencies.js'
import { parseJsonBody } from '../request-body.js'

interface StorageRoutes
  extends Pick<HttpAppDeps, 'artifactStorage' | 'storagePrincipal' | 'canReadFavorite'> {
  service: Pick<ArtifactService, 'resolveArtifact'>
  artifacts: Pick<ArtifactRepository, 'findByPublicId'>
}

export function mountStorageRoutes(app: Hono, deps: StorageRoutes) {
  const storagePrincipal = (request: Request) =>
    deps.storagePrincipal?.(request) ?? Promise.resolve('local')

  app.get('/api/v1/favorites', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '收藏存储未启用')
    const principal = await storagePrincipal(c.req.raw)
    if (!principal) throw new DomainError('UNAUTHORIZED', '请先登录后查看收藏')
    const ids = await listArtifactFavorites(deps.artifactStorage, principal)
    const visible = await Promise.all(
      ids.map(async (id) =>
        deps.canReadFavorite
          ? deps.canReadFavorite(c.req.raw, id)
          : Boolean(await deps.artifacts.findByPublicId(id)),
      ),
    )
    return c.json({ artifactIds: ids.filter((_, index) => visible[index]) }, 200, {
      'Cache-Control': 'private, no-store',
    })
  })

  app.put('/api/v1/artifacts/:id/favorite', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '收藏存储未启用')
    const principal = await storagePrincipal(c.req.raw)
    if (!principal) throw new DomainError('UNAUTHORIZED', '请先登录后收藏')
    const { favorite } = await parseJsonBody(c.req.raw, z.object({ favorite: z.boolean() }))
    const artifact = await deps.service.resolveArtifact(c.req.param('id'))
    await setArtifactFavorite(deps.artifactStorage, principal, artifact.publicId, favorite)
    return c.json({ favorite }, 200, { 'Cache-Control': 'private, no-store' })
  })

  app.post(
    '/api/v1/artifacts/:id/storage',
    bodyLimit({
      maxSize: 128 * 1024,
      onError: () => {
        throw new DomainError('BAD_REQUEST', '制品存储请求过大')
      },
    }),
    async (c) => {
      if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '制品存储未启用')
      const id = PublicIdSchema.safeParse(c.req.param('id'))
      if (!id.success || !(await deps.artifacts.findByPublicId(id.data))) {
        throw new DomainError('NOT_FOUND', '未找到制品')
      }
      const operation = await parseJsonBody(c.req.raw, ArtifactStorageOperationSchema)
      const principal = await storagePrincipal(c.req.raw)
      const value = await executeArtifactStorage(
        deps.artifactStorage,
        id.data,
        principal,
        operation,
      )
      c.header('Cache-Control', 'no-store')
      return c.json({ value })
    },
  )

  app.get('/api/v1/artifacts/:id/storage/usage', async (c) => {
    if (!deps.artifactStorage) throw new DomainError('NOT_FOUND', '制品存储未启用')
    const artifact = await deps.service.resolveArtifact(c.req.param('id'))
    const usage = await getArtifactStorageUsage(
      deps.artifactStorage,
      artifact.publicId,
      await storagePrincipal(c.req.raw),
    )
    return c.json(usage, 200, { 'Cache-Control': 'private, no-store' })
  })
}
