import type { ArtifactIdentifier, Feedback, PublicId, ReviewRound } from '@akasha/protocol'
import { InvalidReceiptError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  RealtimePublisher,
  ReceiptRepository,
  RoundRepository,
} from '../../domain/ports.js'
import type { ResolveArtifact } from '../artifacts/queries.js'

interface DeliveryPorts {
  artifacts: Pick<ArtifactRepository, 'findByPublicId' | 'listByProject'>
  feedbacks: Pick<FeedbackRepository, 'findById' | 'list' | 'save'>
  receipts: ReceiptRepository
  rounds: Pick<RoundRepository, 'listByArtifact'>
  clock: Clock
  ids: Pick<IdGenerator, 'id'>
  realtime: RealtimePublisher
}

export interface PullFeedbackInput {
  id?: ArtifactIdentifier
  projectId?: string
  after?: string
  includeDrafts?: boolean
  detail?: boolean
}

export interface AckFeedbackInput {
  receipt: string
  resolveIds?: readonly string[]
}

/** 只有取得详细反馈才签发消费回执；确认时按回执内的 ID 更新和广播。 */
export class FeedbackDelivery {
  constructor(
    private readonly deps: DeliveryPorts,
    private readonly resolveArtifact: ResolveArtifact,
  ) {}

  async pullFeedback(input: PullFeedbackInput): Promise<{
    items: readonly Feedback[]
    rounds: readonly ReviewRound[]
    cursor: string
    receipt?: string
  }> {
    const artifact = input.id ? await this.resolveArtifact(input.id, input.projectId) : undefined

    // 不按制品读取时也只能拉取活动制品，不能通过全局队列读到撤下内容。
    let artifactIds: Set<PublicId> | undefined
    if (!artifact) {
      const projectArtifacts = await this.deps.artifacts.listByProject(input.projectId)
      artifactIds = new Set(projectArtifacts.map((a) => a.publicId))
      if (artifactIds.size === 0) {
        return { items: [], rounds: [], cursor: input.after ?? '' }
      }
    }

    const { items, cursor } = await this.deps.feedbacks.list({
      artifactId: artifact?.publicId,
      artifactIds,
      afterCursor: input.after,
      includeDrafts: input.includeDrafts ?? false,
    })
    const rounds = artifact
      ? await this.deps.rounds.listByArtifact(artifact.publicId)
      : artifactIds
        ? (
            await Promise.all(
              Array.from(artifactIds, (aid) => this.deps.rounds.listByArtifact(aid)),
            )
          ).flat()
        : []
    const detail = input.detail ?? true

    // 仅完整拉取且存在待消费条目时签发回执；预览摘要不推进消费游标
    let receipt: string | undefined
    if (detail && items.length > 0) {
      receipt = this.deps.ids.id('rcpt')
      await this.deps.receipts.save({
        receipt,
        artifactId: artifact?.publicId ?? null,
        cursor,
        feedbackIds: items.map((i) => i.id),
        issuedAt: this.deps.clock.now(),
      })
    }

    return { items, rounds, cursor, receipt }
  }

  async ackFeedback(input: AckFeedbackInput): Promise<{ acknowledged: number; resolved: number }> {
    const consumed = await this.deps.receipts.consume(input.receipt)
    if (!consumed) {
      throw new InvalidReceiptError(input.receipt)
    }
    const resolveSet = new Set(input.resolveIds ?? [])
    const now = this.deps.clock.now()
    let acknowledged = 0
    let resolved = 0

    for (const id of consumed.feedbackIds) {
      const fb = await this.deps.feedbacks.findById(id)
      if (!fb) continue
      const nextStatus = resolveSet.has(id)
        ? 'resolved'
        : fb.status === 'resolved'
          ? 'resolved'
          : 'delivered'
      const updated: Feedback = { ...fb, status: nextStatus, updatedAt: now }
      await this.deps.feedbacks.save(updated)
      acknowledged++
      if (resolveSet.has(id)) resolved++
      const owner = await this.deps.artifacts.findByPublicId(updated.artifactId)
      await this.deps.realtime.publish(
        {
          type: 'feedback.updated',
          artifactId: updated.artifactId,
          feedback: updated,
        },
        owner ? { projectId: owner.projectId } : undefined,
      )
    }

    return { acknowledged, resolved }
  }
}
