import type {
  Artifact,
  ArtifactIdentifier,
  ArtifactType,
  Author,
  PublicId,
  Slug,
  TextEdit,
  Version,
  Visibility,
} from '@akasha/protocol'
import { PublicIdSchema } from '@akasha/protocol'
import {
  applyTextEdits,
  assertBaseVersion,
  createImmutableVersion,
} from '../../domain/artifact/index.js'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  IdGenerator,
  RealtimePublisher,
  StateRepository,
} from '../../domain/ports.js'
import { DEFAULT_PROJECT_ID, type ResolveArtifact } from './queries.js'
import type { ArtifactWriteLocks } from './write-locks.js'

interface VersionPorts {
  artifacts: ArtifactRepository
  states: Pick<StateRepository, 'saveSnapshot'>
  realtime: RealtimePublisher
  clock: Clock
  ids: Pick<IdGenerator, 'publicId'>
}

export interface PublishArtifactInput {
  projectId?: string
  slug: Slug
  title: string
  type: ArtifactType
  source: string
  baseVersion?: number
  visibility?: Visibility
  author: Author
  // 仅用于本机 `.artifact-id` 对账和 CLI 首发预留，不向 HTTP/MCP 公开。
  preferredPublicId?: PublicId
  // 复制不允许对命中的制品写入新版本。
  createOnly?: true
}

export type UpdateArtifactInput = {
  id: ArtifactIdentifier
  projectId?: string
  baseVersion: number
  title?: string
  author: Author
  /** 等待制品写锁期间撤销的轮次，不得开始写入新版本。 */
  signal?: AbortSignal
} & ({ edits: readonly TextEdit[] } | { source: string })

export interface RevertArtifactInput {
  id: ArtifactIdentifier
  projectId?: string
  targetVersion: number
  baseVersion: number
  author: Author
}

/** 不可变版本的发布、增量替换与历史回退共用同一把制品写锁。 */
export class ArtifactVersions {
  constructor(
    private readonly deps: VersionPorts,
    private readonly resolveArtifact: ResolveArtifact,
    private readonly locks: ArtifactWriteLocks,
  ) {}

  async publish(
    input: PublishArtifactInput,
  ): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const projectId = input.projectId ?? DEFAULT_PROJECT_ID

    return this.locks.forSlug(projectId, input.slug, async () => {
      const existing = await this.deps.artifacts.findBySlug(projectId, input.slug)
      if (existing && input.createOnly) {
        throw new DomainError('RESOURCE_CONFLICT', '目标项目已存在同名制品，原有内容未更改')
      }
      const now = this.deps.clock.now()

      if (!existing) {
        let publicId: PublicId
        if (input.preferredPublicId && PublicIdSchema.safeParse(input.preferredPublicId).success) {
          const taken = await this.deps.artifacts.findByPublicId(input.preferredPublicId)
          if (taken && input.createOnly)
            throw new DomainError('RESOURCE_CONFLICT', '指定的发布地址已被占用，未发布制品')
          if (
            !taken &&
            (await this.deps.artifacts.lifecycle.findWithdrawn(input.preferredPublicId))
          ) {
            throw new DomainError('RESOURCE_CONFLICT', '制品已撤下，恢复前不能重新发布')
          }
          publicId = taken ? this.deps.ids.publicId() : input.preferredPublicId
        } else {
          publicId = this.deps.ids.publicId()
        }
        const version = createImmutableVersion({
          artifactId: publicId,
          version: 1,
          parentVersion: null,
          author: input.author,
          title: input.title.trim() || input.slug,
          source: input.source,
          createdAt: now,
        })
        const artifact: Artifact = {
          publicId,
          slug: input.slug,
          projectId,
          title: version.title,
          type: input.type,
          visibility: input.visibility ?? 'private',
          headVersion: 1,
          createdAt: now,
          updatedAt: now,
        }
        await this.deps.artifacts.saveArtifact(artifact)
        await this.deps.artifacts.appendVersion(version, artifact.type)
        await this.deps.states.saveSnapshot({
          artifactId: publicId,
          seq: 0,
          snapshot: {},
          updatedAt: now,
        })
        await this.deps.realtime.publish(
          {
            type: 'version.created',
            artifactId: publicId,
            version,
          },
          { projectId },
        )
        return { artifact, version }
      }

      // 与按 publicId 寻址的 update/revert 共享同一把 Artifact 锁
      return this.locks.forArtifact(existing.publicId, async () => {
        const fresh = await this.deps.artifacts.findByPublicId(existing.publicId)
        if (!fresh) {
          throw new NotFoundError(`未找到 Artifact "${existing.publicId}"`)
        }
        if (fresh.projectId !== projectId || fresh.slug !== input.slug) {
          throw new DomainError('RESOURCE_CONFLICT', '制品归属已改变，请按目标项目重新定位')
        }
        const versions = await this.deps.artifacts.getVersions(fresh.publicId)
        assertBaseVersion(fresh, versions, input.baseVersion)

        const nextNumber = fresh.headVersion + 1
        const version = createImmutableVersion({
          artifactId: fresh.publicId,
          version: nextNumber,
          parentVersion: fresh.headVersion,
          author: input.author,
          title: input.title.trim() || fresh.title,
          source: input.source,
          createdAt: now,
        })
        const updated: Artifact = {
          ...fresh,
          title: version.title,
          type: input.type,
          visibility: input.visibility ?? fresh.visibility,
          headVersion: nextNumber,
          updatedAt: now,
        }
        await this.deps.artifacts.appendVersion(version, updated.type)
        await this.deps.artifacts.saveArtifact(updated)
        await this.deps.realtime.publish(
          {
            type: 'version.created',
            artifactId: updated.publicId,
            version,
          },
          { projectId: updated.projectId },
        )
        return { artifact: updated, version }
      })
    })
  }

  async update(
    input: UpdateArtifactInput,
  ): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.locks.forArtifact(resolved.publicId, async () => {
      const existing = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!existing || (input.projectId !== undefined && input.projectId !== existing.projectId)) {
        throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      }
      const versions = await this.deps.artifacts.getVersions(existing.publicId)
      assertBaseVersion(existing, versions, input.baseVersion)

      const head = versions.find((v) => v.version === existing.headVersion)
      if (!head) {
        throw new NotFoundError(`缺少头版本 v${existing.headVersion}`)
      }
      const nextSource = 'source' in input ? input.source : applyTextEdits(head.source, input.edits)
      const now = this.deps.clock.now()
      const nextNumber = existing.headVersion + 1
      const version = createImmutableVersion({
        artifactId: existing.publicId,
        version: nextNumber,
        parentVersion: existing.headVersion,
        author: input.author,
        title: input.title?.trim() || existing.title,
        source: nextSource,
        createdAt: now,
      })
      const updated: Artifact = {
        ...existing,
        title: version.title,
        headVersion: nextNumber,
        updatedAt: now,
      }
      input.signal?.throwIfAborted()
      await this.deps.artifacts.appendVersion(version, updated.type)
      await this.deps.artifacts.saveArtifact(updated)
      await this.deps.realtime.publish(
        {
          type: 'version.created',
          artifactId: updated.publicId,
          version,
        },
        { projectId: updated.projectId },
      )
      return { artifact: updated, version }
    })
  }

  async revert(
    input: RevertArtifactInput,
  ): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.locks.forArtifact(resolved.publicId, async () => {
      const existing = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!existing) {
        throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      }
      const versions = await this.deps.artifacts.getVersions(existing.publicId)
      assertBaseVersion(existing, versions, input.baseVersion)

      const target = versions.find((v) => v.version === input.targetVersion)
      if (!target) {
        throw new NotFoundError(`目标版本 v${input.targetVersion} 不存在`)
      }
      const now = this.deps.clock.now()
      const nextNumber = existing.headVersion + 1
      const version = createImmutableVersion({
        artifactId: existing.publicId,
        version: nextNumber,
        parentVersion: existing.headVersion,
        author: input.author,
        title: existing.title,
        source: target.source,
        createdAt: now,
      })
      const updated: Artifact = {
        ...existing,
        headVersion: nextNumber,
        updatedAt: now,
      }
      await this.deps.artifacts.appendVersion(version, updated.type)
      await this.deps.artifacts.saveArtifact(updated)
      await this.deps.realtime.publish(
        {
          type: 'version.created',
          artifactId: updated.publicId,
          version,
        },
        { projectId: updated.projectId },
      )
      return { artifact: updated, version }
    })
  }
}
