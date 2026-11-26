import type {
  Artifact,
  ArtifactIdentifier,
  ArtifactTransferInput,
  Author,
  PublicId,
} from '@akasha/protocol'
import { PublicIdSchema } from '@akasha/protocol'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  ProjectRepository,
  RealtimePublisher,
} from '../../domain/ports.js'
import type { ArtifactReference, ResolveArtifact } from './queries.js'
import type { ArtifactVersions } from './versions.js'
import type { ArtifactWriteLocks } from './write-locks.js'

interface LifecyclePorts {
  artifacts: Pick<
    ArtifactRepository,
    'findByPublicId' | 'getVersion' | 'lifecycle' | 'relocate' | 'renameTitle'
  >
  projects: Pick<ProjectRepository, 'findById'>
  realtime: RealtimePublisher
  clock: Clock
}

export interface RenameArtifactInput extends ArtifactReference {
  title: string
}

/** 管理展示标题、归属和撤下状态；复制通过正常发布路径创建独立制品。 */
export class ArtifactLifecycle {
  constructor(
    private readonly deps: LifecyclePorts,
    private readonly resolveArtifact: ResolveArtifact,
    private readonly locks: ArtifactWriteLocks,
    private readonly versions: Pick<ArtifactVersions, 'publish'>,
  ) {}

  async renameArtifact(input: RenameArtifactInput): Promise<Artifact> {
    const title = input.title.trim()
    if (!title) throw new DomainError('BAD_REQUEST', '制品标题不能为空')
    const { publicId } = await this.resolveArtifact(input.id, input.projectId)
    return this.locks.forArtifact(publicId, async () => {
      const artifact = await this.deps.artifacts.renameTitle(publicId, title, this.deps.clock.now())
      if (!artifact) throw new NotFoundError(`未找到 Artifact "${publicId}"`)
      await this.deps.realtime.publish(
        { type: 'artifact.metadata', artifactId: publicId },
        { projectId: artifact.projectId },
      )
      return artifact
    })
  }

  async transferArtifact(id: ArtifactIdentifier, input: ArtifactTransferInput, author: Author) {
    const artifact = await this.resolveArtifact(id)
    if (artifact.type === 'design-system') {
      throw new DomainError('FORBIDDEN', '设计系统的来源授权仅限当前项目，请在目标项目重新审阅')
    }
    if (!(await this.deps.projects.findById(input.targetProjectId))) {
      throw new NotFoundError('目标项目未在当前服务登记')
    }
    if (input.kind === 'copy') {
      const snapshot = await this.deps.artifacts.getVersion(artifact.publicId, input.version)
      if (!snapshot) throw new NotFoundError(`找不到要复制的固定版本 v${input.version}`)
      return this.versions.publish({
        projectId: input.targetProjectId,
        slug: input.slug,
        title: snapshot.title,
        type: artifact.type,
        source: snapshot.source,
        visibility: 'private',
        createOnly: true,
        author,
      })
    }
    if (input.targetProjectId === artifact.projectId) {
      throw new DomainError('BAD_REQUEST', '请选择不同的目标项目')
    }
    return this.locks.forSlug(input.targetProjectId, artifact.slug, () =>
      this.locks.forArtifact(artifact.publicId, async () => {
        const moved = await this.deps.artifacts.relocate({
          publicId: artifact.publicId,
          sourceProjectId: artifact.projectId,
          targetProjectId: input.targetProjectId,
          updatedAt: this.deps.clock.now(),
        })
        if (!moved)
          throw new DomainError('RESOURCE_CONFLICT', '制品归属或目标项目已改变，未移动制品')
        await this.deps.realtime.publish(
          { type: 'artifact.metadata', artifactId: moved.publicId },
          { projectId: moved.projectId },
        )
        return { artifact: moved }
      }),
    )
  }

  async setArtifactWithdrawal(publicId: PublicId, withdrawn: boolean): Promise<Artifact> {
    if (!PublicIdSchema.safeParse(publicId).success) throw new NotFoundError('未找到制品')
    const lifecycle = this.deps.artifacts.lifecycle
    return this.locks.forArtifact(publicId, async () => {
      const artifact = withdrawn
        ? await this.deps.artifacts.findByPublicId(publicId)
        : (await lifecycle.findWithdrawn(publicId))?.artifact
      if (
        !artifact ||
        !(await lifecycle.setWithdrawal(publicId, withdrawn ? this.deps.clock.now() : null))
      ) {
        throw new NotFoundError(withdrawn ? '未找到活动制品' : '未找到可恢复的制品')
      }
      await this.deps.realtime.publish(
        { type: 'artifact.metadata', artifactId: artifact.publicId },
        { projectId: artifact.projectId },
      )
      return artifact
    })
  }
}
