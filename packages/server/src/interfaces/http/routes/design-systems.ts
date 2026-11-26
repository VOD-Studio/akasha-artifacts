import { DesignSystemPreviewInputSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { previewDesignSystem } from '../../../application/design-systems/review.js'
import { NotFoundError } from '../../../domain/errors.js'
import type { ProjectRepository } from '../../../domain/ports.js'
import { parseJsonBody } from '../request-body.js'

/** 项目是 URL 的授权对象，不能由请求体或组件引用改写。 */
export function mountDesignSystemRoutes(
  app: Hono,
  deps: {
    projects: Pick<ProjectRepository, 'findById'>
  },
) {
  const root = '/api/v1/projects/:projectId/design-systems'
  app.use(
    `${root}/*`,
    bodyLimit({
      maxSize: 24 * 1024 * 1024,
      onError: (c) =>
        c.json({ error: { code: 'BAD_REQUEST', message: '来源请求超过大小限制' } }, 413),
    }),
  )
  app.use(`${root}/*`, async (c, next) => {
    const project = await deps.projects.findById(c.req.param('projectId'))
    if (!project) throw new NotFoundError('请先选择已登记的项目')
    await next()
  })
  app.post(`${root}/preview`, async (c) => {
    const input = await parseJsonBody(c.req.raw, DesignSystemPreviewInputSchema)
    return c.json(await previewDesignSystem(input))
  })
}
