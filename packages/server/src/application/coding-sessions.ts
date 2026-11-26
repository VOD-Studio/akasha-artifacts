import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { parseDesignSystem } from '@akasha/kit'
import {
  type ArtifactHandoffReference,
  type CodingSessionRead,
  describeHandoff,
  readDesignSystemReference,
} from '@akasha/protocol'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { DomainError } from '../domain/errors.js'
import type { ArtifactRepository, Clock, ProjectRepository } from '../domain/ports.js'

interface Session {
  id: string
  label: string
  digest: string
  expiresAt: string
  reference: ArtifactHandoffReference
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const namespace = (project: string) => JSON.stringify(['coding-sessions', project])

/** 会话固定项目、作品与基线；读取与发布都不会启动项目进程。 */
export class CodingSessions {
  constructor(
    private readonly store: ArtifactStorageRepository,
    private readonly artifacts: ArtifactRepository,
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
  ) {}

  private async active(project: string) {
    if (!(await this.projects.findById(project))) throw new DomainError('NOT_FOUND', '找不到项目')
    const row = await this.store.read(namespace(project))
    const now = this.clock.now()
    const records: Session[] = row ? JSON.parse(row.json) : []
    return {
      records: records.filter((record) => record.expiresAt > now),
      revision: row?.revision ?? 0,
    }
  }

  async connect(project: string, label: string, reference: ArtifactHandoffReference) {
    if (reference.projectId !== project) throw new DomainError('FORBIDDEN', '交接不属于当前项目')
    await this.snapshot(reference)
    const { records, revision } = await this.active(project)
    if (records.length >= 128) throw new DomainError('RATE_LIMITED', '项目编码会话已达上限')
    const token = randomBytes(32).toString('hex')
    const id = randomUUID()
    const expiresAt = new Date(Date.parse(this.clock.now()) + 8 * 60 * 60 * 1000).toISOString()
    records.push({ id, label, digest: digest(token), expiresAt, reference })
    if (!(await this.store.compareAndSet(namespace(project), revision, JSON.stringify(records))))
      throw new DomainError('RESOURCE_CONFLICT', '连接列表已更改，请重新签入')
    return { id, token, expiresAt }
  }

  async authorize(project: string, id: string, token: string) {
    const { records } = await this.active(project)
    const hash = digest(token)
    const session = records.find((entry) => entry.id === id && entry.digest === hash)
    if (!session) throw new DomainError('UNAUTHORIZED', '会话凭证无效或已过期')
    return session.reference
  }

  async read(project: string, id: string, token: string) {
    return this.snapshot(await this.authorize(project, id, token))
  }

  private async snapshot(reference: ArtifactHandoffReference): Promise<CodingSessionRead> {
    const { artifactId, projectId, version } = reference
    const artifact = await this.artifacts.findByPublicId(artifactId)
    if (!artifact || artifact.projectId !== projectId)
      throw new DomainError('NOT_FOUND', '作品不在所选项目')
    const fixed = await this.artifacts.getVersion(artifactId, version)
    if (!fixed) throw new DomainError('NOT_FOUND', '找不到交接的固定版本')
    let design: CodingSessionRead['design']
    try {
      design = describeHandoff(artifact, fixed, reference)
    } catch (error) {
      throw new DomainError('BAD_REQUEST', error instanceof Error ? error.message : '选区无效')
    }
    const provenance = readDesignSystemReference(fixed.source)
    const components: CodingSessionRead['components'] = []
    if (provenance) {
      const system = await this.artifacts.findByPublicId(provenance.id)
      if (system?.type !== 'design-system' || system.projectId !== projectId)
        throw new DomainError('NOT_FOUND', '组件来源不在当前项目')
      const source = await this.artifacts.getVersion(system.publicId, provenance.version)
      const parsed = source && parseDesignSystem(source.source)
      if (!parsed?.ok || parsed.data.sourceVersion !== provenance.sourceVersion)
        throw new DomainError('NOT_FOUND', '组件来源固定版本不可用')
      const { draft } = parsed.data
      for (const entry of provenance.components) {
        const reviewed = draft.components.some(
          (item) => item.path === entry.path && item.exportName === entry.exportName,
        )
        const file = draft.files.find((item) => item.kind === 'source' && item.path === entry.path)
        if (!reviewed || !file) throw new DomainError('BAD_REQUEST', '组件未经该版本审阅')
        components.push({ ...entry, source: file.content })
      }
    }
    return { reference, design, components }
  }
}
