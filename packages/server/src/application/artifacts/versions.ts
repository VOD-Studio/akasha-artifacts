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
  WorkspaceComponent,
} from '../../domain/ports.js'
import { mergeCanvasSource } from './merge-canvas-source.js'
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
  /** 仅由编码会话用例传入，普通源码替换不继承前一版入口。 */
  workspaceComponent?: WorkspaceComponent
  /** 等待制品写锁期间撤销的轮次，不得开始写入新版本。 */
  signal?: AbortSignal
} & ({ edits: readonly TextEdit[] } | { source: string })

/** 写锁内按实际作品及有效授权签名，不接受 HTTP 请求指定作者。 */
export interface CanvasEditInput {
  publicId: PublicId
  baseVersion: number
  source: string
  authorize: (artifact: Artifact) => Promise<Author>
}

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
    authority?: 'reviewed-system',
  ): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const projectId = input.projectId ?? DEFAULT_PROJECT_ID
    if (input.type === 'design-system' && authority !== 'reviewed-system') {
      throw new DomainError('FORBIDDEN', '请通过设计系统审阅流程发布来源')
    }

    return this.locks.forSlug(projectId, input.slug, async () => {
      const existing = await this.deps.artifacts.findBySlug(projectId, input.slug)
      if (existing?.type === 'design-system' && authority !== 'reviewed-system') {
        throw new DomainError('FORBIDDEN', '设计系统不能通过通用发布接口替换或转换类型')
      }
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
    authority?: 'reviewed-system',
  ): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.locks.forArtifact(resolved.publicId, async () => {
      const existing = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!existing || (input.projectId !== undefined && input.projectId !== existing.projectId)) {
        throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      }
      if (existing.type === 'design-system' && authority !== 'reviewed-system') {
        throw new DomainError('FORBIDDEN', '请通过设计系统审阅流程确认变更')
      }
      const versions = await this.deps.artifacts.getVersions(existing.publicId)
      assertBaseVersion(existing, versions, input.baseVersion)

      const head = versions.find((v) => v.version === existing.headVersion)
      if (!head) {
        throw new NotFoundError(`缺少头版本 v${existing.headVersion}`)
      }
      const nextSource = 'source' in input ? input.source : applyTextEdits(head.source, input.edits)
      return this.appendUpdate(existing, nextSource, input)
    })
  }

  async editCanvas(input: CanvasEditInput) {
    return this.locks.forArtifact(input.publicId, async () => {
      const artifact = await this.deps.artifacts.findByPublicId(input.publicId)
      if (!artifact) throw new NotFoundError('未找到请求的资源')
      const author = await input.authorize(artifact)
      if (artifact.type !== 'artboard')
        throw new DomainError('BAD_REQUEST', '共同编辑仅支持设计画板')
      const base = await this.deps.artifacts.getVersion(artifact.publicId, input.baseVersion)
      if (!base) throw new NotFoundError('未找到编辑所用的基准版本')
      const head =
        base.version === artifact.headVersion
          ? base
          : await this.deps.artifacts.getVersion(artifact.publicId, artifact.headVersion)
      if (!head) throw new NotFoundError('未找到头版本')
      const source = mergeCanvasSource(base.source, head.source, input.source)
      if (source === head.source) return { artifact, version: head, unchanged: true }
      return this.appendUpdate(artifact, source, { author })
    })
  }

  private async appendUpdate(
    existing: Artifact,
    source: string,
    input: Pick<UpdateArtifactInput, 'author' | 'title' | 'signal' | 'workspaceComponent'>,
  ) {
    const now = this.deps.clock.now()
    const version = createImmutableVersion({
      artifactId: existing.publicId,
      version: existing.headVersion + 1,
      parentVersion: existing.headVersion,
      author: input.author,
      title: input.title?.trim() || existing.title,
      source,
      createdAt: now,
    })
    const updated: Artifact = {
      ...existing,
      title: version.title,
      headVersion: version.version,
      updatedAt: now,
    }
    input.signal?.throwIfAborted()
    await this.deps.artifacts.appendVersion(version, updated.type, input.workspaceComponent)
    await this.deps.artifacts.saveArtifact(updated)
    await this.deps.realtime.publish(
      { type: 'version.created', artifactId: updated.publicId, version },
      { projectId: updated.projectId },
    )
    return { artifact: updated, version }
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
      if (existing.type === 'design-system') {
        throw new DomainError('FORBIDDEN', '请在审阅流程中确认历史来源及移除项')
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
      const component =
        existing.type === 'react'
          ? await this.deps.artifacts.getWorkspaceComponent(existing.publicId, target.version)
          : undefined
      await this.deps.artifacts.appendVersion(version, updated.type, component)
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
