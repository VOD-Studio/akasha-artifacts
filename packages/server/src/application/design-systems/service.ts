import { createHash, randomBytes } from 'node:crypto'
import { generateDesignSystemBoard, parseDesignSystem } from '@akasha/kit'
import type {
  Author,
  DesignSystemDraft,
  DesignSystemGenerateInput,
  DesignSystemPreviewInput,
  DesignSystemPreviewOutput,
  DesignSystemPublishInput,
  DesignSystemSnapshot,
} from '@akasha/protocol'
import { removedDesignSystemItems } from '@akasha/protocol'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import type { ArtifactRepository } from '../../domain/ports.js'
import type { ArtifactVersions } from '../artifacts/versions.js'
import { previewDesignSystem } from './review.js'

type CompiledPreview = Omit<DesignSystemSnapshot, 'draft'>
interface Review {
  project: string
  digest: string
  expires: number
  bytes: number
  output: CompiledPreview
}
const REVIEW_CAPACITY = 64 * 1024 * 1024

/** 审阅凭证只指向本进程内已构建的输出；过期、重启或淘汰后必须重新预览。 */
export class DesignSystems {
  private readonly reviews = new Map<string, Review>()
  private bytes = 0

  constructor(
    private readonly artifacts: Pick<ArtifactRepository, 'findByPublicId' | 'getVersion'>,
    private readonly versions: Pick<ArtifactVersions, 'publish' | 'update'>,
  ) {}

  async preview(
    project: string,
    input: DesignSystemPreviewInput,
  ): Promise<DesignSystemPreviewOutput> {
    const output = await previewDesignSystem(input)
    const bytes = output.previewSource.length * 2
    if (bytes > REVIEW_CAPACITY) throw new DomainError('BAD_REQUEST', '组件输出过大，未建立预览')
    const now = Date.now()
    for (const [key, review] of this.reviews) {
      if (review.expires > now && this.bytes + bytes <= REVIEW_CAPACITY && this.reviews.size < 64)
        break
      this.reviews.delete(key)
      this.bytes -= review.bytes
    }
    const reviewToken = randomBytes(32).toString('hex')
    const digest = this.draftDigest(input.draft)
    this.reviews.set(reviewToken, { project, digest, expires: now + 30 * 60 * 1000, bytes, output })
    this.bytes += bytes
    return { previewSource: output.previewSource, sourceVersion: output.sourceVersion, reviewToken }
  }

  async publish(project: string, input: DesignSystemPublishInput, author: Author) {
    const review = this.reviews.get(input.reviewToken)
    if (
      !review ||
      review.project !== project ||
      review.expires <= Date.now() ||
      review.digest !== this.draftDigest(input.draft)
    )
      throw new DomainError('FORBIDDEN', '草稿未审阅或预览已过期')
    if (input.draft.components.length && !input.buildApproved)
      throw new DomainError('FORBIDDEN', '尚未许可使用组件构建结果')
    const snapshot: DesignSystemSnapshot = { draft: input.draft, ...review.output }
    if (input.id && input.baseVersion !== undefined) {
      const { artifact, snapshot: previous } = await this.read(project, input.id, input.baseVersion)
      if (artifact.slug !== input.slug)
        throw new DomainError('BAD_REQUEST', '重同步不能改变作品别名')
      const missing = removedDesignSystemItems(previous.draft, input.draft)
      const confirmed = new Set(input.confirmedRemovals)
      if (confirmed.size !== missing.length || missing.some((item) => !confirmed.has(item)))
        throw new DomainError('BAD_REQUEST', '请逐项确认缺失内容', { missing })
      return this.versions.update(
        {
          id: artifact.publicId,
          projectId: project,
          baseVersion: input.baseVersion,
          title: input.title,
          source: JSON.stringify(snapshot),
          author,
        },
        'reviewed-system',
      )
    }
    if (input.confirmedRemovals.length)
      throw new DomainError('BAD_REQUEST', '首次发布没有可移除的内容')
    return this.versions.publish(
      {
        projectId: project,
        slug: input.slug,
        title: input.title,
        type: 'design-system',
        source: JSON.stringify(snapshot),
        author,
        createOnly: true,
      },
      'reviewed-system',
    )
  }

  async generate(project: string, input: DesignSystemGenerateInput, author: Author) {
    const { snapshot } = await this.read(project, input.id, input.version)
    const entry = input.component
    const index = entry
      ? snapshot.draft.components.findIndex(
          (item) => item.path === entry.path && item.exportName === entry.exportName,
        )
      : null
    if (index === -1) throw new DomainError('BAD_REQUEST', '该版本未审阅所选组件')
    const source = generateDesignSystemBoard(
      snapshot,
      { id: input.id, version: input.version },
      index,
    )
    return this.versions.publish({
      projectId: project,
      slug: input.slug,
      title: input.title,
      type: 'react',
      source,
      author,
      createOnly: true,
    })
  }

  private draftDigest(draft: DesignSystemDraft) {
    return createHash('sha256').update(JSON.stringify(draft)).digest('hex')
  }

  private async read(project: string, id: string, version: number) {
    const artifact = await this.artifacts.findByPublicId(id)
    if (artifact?.projectId !== project || artifact.type !== 'design-system')
      throw new NotFoundError('找不到项目内的设计系统')
    const fixed = await this.artifacts.getVersion(id, version)
    if (!fixed) throw new NotFoundError('找不到设计系统版本')
    const parsed = parseDesignSystem(fixed.source)
    if (!parsed.ok) throw new DomainError('BAD_REQUEST', parsed.error)
    return { artifact, snapshot: parsed.data }
  }
}
