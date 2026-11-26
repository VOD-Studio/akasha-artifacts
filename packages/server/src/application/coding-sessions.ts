import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { generateDesignSystemBoard, parseDesignSystem } from '@akasha/kit'
import {
  type ArtifactHandoffReference,
  type CodingSessionRead,
  type CodingTarget,
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
  reference?: ArtifactHandoffReference
  // 未绑定会话仅在前台客户端最近签报可用时可供选择。
  availableUntil?: number
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
    private readonly ownerActive?: (project: string) => Promise<boolean>,
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

  async connect(
    project: string,
    label: string,
    reference?: ArtifactHandoffReference,
    credentialExpiry = Infinity,
  ) {
    if (reference) {
      if (reference.projectId !== project) throw new DomainError('FORBIDDEN', '交接不属于当前项目')
      await this.snapshot(reference)
    }
    const { records, revision } = await this.active(project)
    if (records.length >= 128) throw new DomainError('RATE_LIMITED', '项目编码会话已达上限')
    const token = randomBytes(32).toString('hex')
    const id = randomUUID()
    const expiresAt = new Date(
      Math.min(credentialExpiry, Date.parse(this.clock.now()) + 8 * 60 * 60 * 1000),
    ).toISOString()
    records.push({ id, label, digest: digest(token), expiresAt, reference })
    if (!(await this.store.compareAndSet(namespace(project), revision, JSON.stringify(records))))
      throw new DomainError('RESOURCE_CONFLICT', '连接列表已更改，请重新签入')
    return { id, token, expiresAt }
  }

  private async consumer(project: string, id: string, token: string) {
    const { records, revision } = await this.active(project)
    const hash = digest(token)
    const session = records.find((entry) => entry.id === id && entry.digest === hash)
    if (!session) throw new DomainError('UNAUTHORIZED', '会话凭证无效或已过期')
    if (this.ownerActive && !(await this.ownerActive(project)))
      throw new DomainError('FORBIDDEN', '项目所有者不再具有 Hub 成员权限')
    return { records, revision, session }
  }

  async authorize(project: string, id: string, token: string) {
    const { session } = await this.consumer(project, id, token)
    if (!session.reference) throw new DomainError('RESOURCE_CONFLICT', '请先在作品中移交给本会话')
    return session.reference
  }

  async poll(project: string, id: string, token: string) {
    const { session, revision, records } = await this.consumer(project, id, token)
    if (session.reference) return { bound: true }
    const now = Date.parse(this.clock.now())
    if ((session.availableUntil ?? 0) < now + 15_000) {
      session.availableUntil = now + 30_000
      // 列表并发变化只跳过本次心跳；下一次轮询重新读取绑定或续租。
      await this.store.compareAndSet(namespace(project), revision, JSON.stringify(records))
    }
    return { bound: false }
  }

  async targets(project: string, reference: ArtifactHandoffReference): Promise<CodingTarget[]> {
    if (reference.projectId !== project) throw new DomainError('FORBIDDEN', '交接不属于当前项目')
    const { records } = await this.active(project)
    const now = Date.parse(this.clock.now())
    const key = JSON.stringify(reference)
    return records
      .filter((entry) =>
        entry.reference
          ? JSON.stringify(entry.reference) === key
          : (entry.availableUntil ?? 0) > now,
      )
      .map(({ id, label, reference: bound }) => ({ id, label, bound: !!bound }))
  }

  async bind(
    project: string,
    id: string,
    reference: ArtifactHandoffReference,
  ): Promise<CodingTarget> {
    if (reference.projectId !== project) throw new DomainError('FORBIDDEN', '交接不属于当前项目')
    const { records, revision } = await this.active(project)
    const entry = records.find((item) => item.id === id)
    if (!entry) throw new DomainError('NOT_FOUND', '会话不存在或已过期')
    if (entry.reference) {
      if (JSON.stringify(entry.reference) !== JSON.stringify(reference))
        throw new DomainError('RESOURCE_CONFLICT', '会话已绑定其他交接')
    } else {
      await this.snapshot(reference)
      if ((entry.availableUntil ?? 0) <= Date.parse(this.clock.now()))
        throw new DomainError('RESOURCE_CONFLICT', '终端不再等待移交')
      entry.reference = reference
      if (!(await this.store.compareAndSet(namespace(project), revision, JSON.stringify(records))))
        throw new DomainError('RESOURCE_CONFLICT', '会话已变更，请刷新目标')
    }
    return { id, label: entry.label, bound: true }
  }

  async read(project: string, id: string, token: string) {
    return this.snapshot(await this.authorize(project, id, token))
  }

  /** 此入口只供已验证的项目所有者使用，不接受客户端重报作品或基线。 */
  async forOwner(project: string, id: string) {
    const { records } = await this.active(project)
    const session = records.find((entry) => entry.id === id)
    if (!session?.reference) throw new DomainError('NOT_FOUND', '编码会话未绑定或已过期')
    return { reference: session.reference, target: { id, label: session.label, bound: true } }
  }

  async workspace(project: string, id: string) {
    const { reference, target } = await this.forOwner(project, id)
    const snapshot = await this.snapshot(reference)
    const { artifactId, version } = reference
    const [next] = await this.artifacts.getVersionSummaries(artifactId, version + 1)
    // 会话只能从这个基线成功发布一次；恢复时不把其他作者的后继版本当作回传结果。
    const mine =
      next && (next.author === `agent:coding-${id}` || next.author === `human:coding-${id}`)
    const publication = mine
      ? { artifactId, version: next.version, path: `/a/${artifactId}/v/${next.version}` }
      : null
    return { target, snapshot, publication }
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
    const workspace = await this.artifacts.getWorkspaceComponent(artifactId, version)
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
      let single: number | null = null
      for (const entry of provenance.components) {
        const index = draft.components.findIndex(
          (item) => item.path === entry.path && item.exportName === entry.exportName,
        )
        const file = draft.files.find((item) => item.kind === 'source' && item.path === entry.path)
        if (index < 0 || !file) throw new DomainError('BAD_REQUEST', '组件未经该版本审阅')
        if (provenance.components.length === 1) single = index
        if (!workspace) components.push({ ...entry, source: file.content, origin: 'reviewed' })
      }
      // 引用头只证明历史来源；只有原审阅快照能生成的整稿，才可把原文件作为当前实现交接。
      if (
        components.length &&
        fixed.source !==
          generateDesignSystemBoard(
            parsed.data,
            { id: system.publicId, version: provenance.version },
            single,
          )
      ) {
        components.length = 0
      }
    }
    if (workspace) components.push({ ...workspace, origin: 'workspace' })
    return { reference, design, components, reviewedSystem: provenance }
  }
}
