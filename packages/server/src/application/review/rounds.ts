import type { ReviewGroup, ReviewRound, Verdict } from '@akasha/protocol'
import { NotFoundError } from '../../domain/errors.js'
import type {
  Clock,
  FeedbackRepository,
  IdGenerator,
  RealtimePublisher,
  RoundRepository,
} from '../../domain/ports.js'
import {
  applyGroupDecision,
  closeActiveRounds,
  createReviewRound,
  submitReviewRound,
  withdrawReviewRound,
} from '../../domain/round/index.js'
import type { ArtifactReference, ResolveArtifact } from '../artifacts/queries.js'

interface ReviewRoundPorts {
  rounds: RoundRepository
  feedbacks: Pick<FeedbackRepository, 'promoteRoundDrafts'>
  clock: Clock
  ids: Pick<IdGenerator, 'id'>
  realtime: RealtimePublisher
}

export interface OpenRoundInput extends ArtifactReference {
  groups: ReviewGroup[]
}

export interface RecordDecisionInput extends ArtifactReference {
  roundId?: string
  groupId?: string
  choice?: string | null
  verdict?: Verdict
  note?: string
  submitRound?: boolean
  fromAgent?: boolean
}

export interface RoundReference extends ArtifactReference {
  roundId: string
}

/** 提交轮次先转正草稿，再存储并通知订阅者；撤回不反转已投递的草稿。 */
export class ReviewRounds {
  constructor(
    private readonly deps: ReviewRoundPorts,
    private readonly resolveArtifact: ResolveArtifact,
  ) {}

  async openRound(input: OpenRoundInput): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const existing = await this.deps.rounds.listByArtifact(artifact.publicId)
    const closed = closeActiveRounds(existing)
    const round = createReviewRound({
      id: this.deps.ids.id('round'),
      artifactId: artifact.publicId,
      groups: input.groups,
      createdAt: this.deps.clock.now(),
    })
    await this.deps.rounds.replaceRounds(artifact.publicId, [...closed, round])
    await this.deps.realtime.publish(
      {
        type: 'round.updated',
        artifactId: artifact.publicId,
        round,
      },
      { projectId: artifact.projectId },
    )
    return round
  }

  async recordDecision(input: RecordDecisionInput): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const rounds = await this.deps.rounds.listByArtifact(artifact.publicId)
    const target = input.roundId ? rounds.find((r) => r.id === input.roundId) : rounds.at(-1)
    if (!target) {
      throw new NotFoundError('当前 Artifact 没有可用的评审轮次')
    }
    let next = target
    if (input.groupId) {
      next = applyGroupDecision(next, {
        groupId: input.groupId,
        choice: input.choice,
        verdict: input.verdict,
        note: input.note,
        fromAgent: input.fromAgent,
      })
    }
    const now = this.deps.clock.now()
    if (input.submitRound) {
      next = submitReviewRound(next, now)
      await this.deps.feedbacks.promoteRoundDrafts(artifact.publicId, next.id, now)
    }
    await this.deps.rounds.saveRound(next)
    await this.deps.realtime.publish(
      {
        type: 'round.updated',
        artifactId: artifact.publicId,
        round: next,
      },
      { projectId: artifact.projectId },
    )
    return next
  }

  async submitRound(input: RoundReference): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const round = await this.deps.rounds.findById(artifact.publicId, input.roundId)
    if (!round) {
      throw new NotFoundError(`未找到轮次 "${input.roundId}"`)
    }
    const now = this.deps.clock.now()
    const submitted = submitReviewRound(round, now)
    await this.deps.feedbacks.promoteRoundDrafts(artifact.publicId, submitted.id, now)
    await this.deps.rounds.saveRound(submitted)
    await this.deps.realtime.publish(
      {
        type: 'round.updated',
        artifactId: artifact.publicId,
        round: submitted,
      },
      { projectId: artifact.projectId },
    )
    return submitted
  }

  async withdrawRound(input: RoundReference): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const round = await this.deps.rounds.findById(artifact.publicId, input.roundId)
    if (!round) {
      throw new NotFoundError(`未找到轮次 "${input.roundId}"`)
    }
    const withdrawn = withdrawReviewRound(round)
    await this.deps.rounds.saveRound(withdrawn)
    await this.deps.realtime.publish(
      {
        type: 'round.updated',
        artifactId: artifact.publicId,
        round: withdrawn,
      },
      { projectId: artifact.projectId },
    )
    return withdrawn
  }
}
