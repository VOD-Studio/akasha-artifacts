import { type Artifact, ElementRefSchema } from '@akasha/protocol'
import type { Hono } from 'hono'
import { z } from 'zod'
import type { ArtifactService } from '../../../application/artifact-service.js'
import { DomainError } from '../../../domain/errors.js'
import type { ArtifactRepository, Clock, ProjectRepository } from '../../../domain/ports.js'
import { parseJsonBody } from '../request-body.js'

const RegisterProjectBodySchema = z.object({
  id: z.string().min(1).optional(),
  rootPath: z.string().min(1),
  name: z.string().min(1),
})

const ProjectSelectionBodySchema = z.object({
  artifactId: z.string().min(1).optional(),
  element: ElementRefSchema.nullable(),
  draftText: z.string().max(4000).optional(),
})

interface ProjectRoutes {
  service: Pick<ArtifactService, 'registerProject'>
  projects: Pick<ProjectRepository, 'list' | 'remove'>
  artifacts: Pick<ArtifactRepository, 'findByPublicId'>
  clock: Clock
}

/** 选区属于单次应用实例；撤下制品的路由只能清理匹配该制品的当前选区。 */
export function mountProjectRoutes(app: Hono, deps: ProjectRoutes) {
  // 项目级浏览器当前选区与草稿快照（供 UserPromptSubmit / PreInvocation Hook 即时注入上下文）
  const selectionStore = new Map<
    string,
    {
      projectId: string
      artifactId?: string
      element: z.infer<typeof ElementRefSchema> | null
      draftText?: string
      updatedAt: string
    }
  >()

  app.get('/api/v1/projects', async (c) => {
    const projects = await deps.projects.list()
    const nowMs = Date.parse(deps.clock.now())
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    return c.json({
      projects: projects.map((p) => ({
        ...p,
        dormant: nowMs - Date.parse(p.lastActiveAt) > sevenDaysMs,
      })),
    })
  })

  app.post('/api/v1/projects', async (c) => {
    const body = await parseJsonBody(c.req.raw, RegisterProjectBodySchema)
    const project = await deps.service.registerProject(body)
    return c.json({ project }, 201)
  })

  app.delete('/api/v1/projects/:id', async (c) => {
    const id = c.req.param('id')
    const removed = await deps.projects.remove(id)
    if (!removed) {
      throw new DomainError('NOT_FOUND', `未找到项目 "${id}"`)
    }
    selectionStore.delete(id)
    return c.json({ ok: true as const, id })
  })

  app.get('/api/v1/projects/:id/selection', async (c) => {
    const id = c.req.param('id')
    const selected = selectionStore.get(id)
    if (selected?.artifactId) {
      const artifact = await deps.artifacts.findByPublicId(selected.artifactId)
      if (artifact?.projectId !== id) {
        if (selectionStore.get(id) === selected) selectionStore.delete(id)
        return c.json({ selection: null })
      }
    }
    return c.json({ selection: selected ?? null })
  })

  app.post('/api/v1/projects/:id/selection', async (c) => {
    const id = c.req.param('id')
    const body = await parseJsonBody(c.req.raw, ProjectSelectionBodySchema)
    if (!body.element && !body.draftText?.trim()) {
      selectionStore.delete(id)
      return c.json({ selection: null })
    }
    if (body.artifactId) {
      const artifact = await deps.artifacts.findByPublicId(body.artifactId)
      if (artifact?.projectId !== id)
        throw new DomainError('NOT_FOUND', '未找到当前项目内的活动制品')
    }
    const selection = {
      projectId: id,
      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
      element: body.element,
      ...(body.draftText !== undefined ? { draftText: body.draftText } : {}),
      updatedAt: deps.clock.now(),
    }
    selectionStore.set(id, selection)
    return c.json({ selection })
  })

  return (artifact: Artifact) => {
    if (selectionStore.get(artifact.projectId)?.artifactId === artifact.publicId)
      selectionStore.delete(artifact.projectId)
  }
}
