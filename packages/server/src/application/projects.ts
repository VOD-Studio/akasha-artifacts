import type { Project } from '@akasha/protocol'
import type { Clock, IdGenerator, ProjectRepository } from '../domain/ports.js'

interface RegistrationPorts {
  projects: Pick<ProjectRepository, 'findByRootPath' | 'upsert'>
  clock: Clock
  ids: Pick<IdGenerator, 'id'>
}

export interface RegisterProjectInput {
  id?: string
  rootPath: string
  name: string
}

/** 同一 `rootPath` 重复登记时沿用既有 `id`。 */
export async function registerProject(
  deps: RegistrationPorts,
  input: RegisterProjectInput,
): Promise<Project> {
  const existing = await deps.projects.findByRootPath(input.rootPath)
  const now = deps.clock.now()
  const project: Project = {
    id: existing?.id ?? input.id ?? deps.ids.id('proj'),
    rootPath: input.rootPath,
    name: input.name.trim() || input.rootPath,
    lastActiveAt: now,
  }
  return deps.projects.upsert(project)
}
