import type {
  AnnotationReply,
  AnnotationThread,
  Artifact,
  ArtifactIdentifier,
  Author,
  ElementRef,
  Feedback,
  FeedbackKind,
} from '@akasha/protocol'
import { isAnnotationKind } from '@akasha/protocol'
import { NotFoundError } from '../../domain/errors.js'
import {
  isDraftFeedback,
  shouldDispatchToBoundAgent,
  shouldNotifyImmediately,
} from '../../domain/feedback/index.js'
import type {
  AnnotationAgentDispatcher,
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  RealtimePublisher,
  RoundRepository,
} from '../../domain/ports.js'
import type { ArtifactWorkspaceRead } from '../artifact-workspace-read.js'
import type { ArtifactReference, ResolveArtifact } from '../artifacts/queries.js'

interface FeedbackPorts {
  artifacts: Pick<ArtifactRepository, 'getVersion'>
  feedbacks: Pick<FeedbackRepository, 'annotations' | 'findById' | 'listForReview' | 'save'>
  rounds: Pick<RoundRepository, 'findById'>
  clock: Clock
  ids: Pick<IdGenerator, 'id'>
  realtime: RealtimePublisher
  annotationAgent?: AnnotationAgentDispatcher
}

export interface SubmitFeedbackInput {
  id: ArtifactIdentifier
  projectId?: string
  version: number
  roundId?: string | null
  groupId?: string | null
  kind: FeedbackKind
  audience?: Feedback['audience']
  element?: ElementRef | null
  body: string
  author: Author
}

export interface ReviewFeedbackQuery extends ArtifactReference {
  includeDrafts: boolean
}

export interface DiscussionActionInput extends ArtifactReference {
  feedbackId: string
  includeDrafts: boolean
  author: Author
}

/** 草稿和讨论的可见性独立于 Agent 投递；讨论沿用根批注的版本和定位。 */
export class ReviewFeedback {
  constructor(
    private readonly deps: FeedbackPorts,
    private readonly resolveArtifact: ResolveArtifact,
    private readonly workspace: Pick<ArtifactWorkspaceRead, 'resolveLegacyFeedback'>,
  ) {}

  async submitFeedback(input: SubmitFeedbackInput, idPrefix = 'fb'): Promise<Feedback> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const ver = await this.deps.artifacts.getVersion(artifact.publicId, input.version)
    if (!ver) {
      throw new NotFoundError(`反馈绑定的版本 v${input.version} 不存在`)
    }
    const round = input.roundId
      ? await this.deps.rounds.findById(artifact.publicId, input.roundId)
      : undefined
    const now = this.deps.clock.now()
    const feedback: Feedback = {
      id: this.deps.ids.id(idPrefix),
      artifactId: artifact.publicId,
      version: input.version,
      roundId: input.roundId ?? null,
      groupId: input.groupId ?? null,
      kind: input.kind,
      ...(input.audience && { audience: input.audience }),
      element: input.element ?? null,
      body: input.body,
      author: input.author,
      draft: isDraftFeedback(round),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    }
    await this.deps.feedbacks.save(feedback)
    if (shouldNotifyImmediately(feedback)) {
      await this.deps.realtime.publish(
        {
          type: 'feedback.created',
          artifactId: artifact.publicId,
          feedback,
        },
        { projectId: artifact.projectId },
      )
    } else if (feedback.audience !== undefined) {
      await this.deps.realtime.publish(
        { type: 'annotation.changed', artifactId: artifact.publicId },
        { projectId: artifact.projectId },
      )
    }
    if (shouldDispatchToBoundAgent(feedback)) {
      await this.deps.annotationAgent?.dispatchFeedback(artifact, feedback)
    }
    return feedback
  }

  async listFeedbackForReview(
    input: ReviewFeedbackQuery,
  ): Promise<{ items: readonly Feedback[]; threads: Record<string, AnnotationThread> }> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const { feedbacks } = this.deps
    const [items, threads] = await Promise.all([
      feedbacks.listForReview(artifact.publicId, input.includeDrafts),
      feedbacks.annotations.list(artifact.publicId, input.includeDrafts),
    ])
    await this.deps.annotationAgent?.reconcileDeliveries(artifact, threads)
    return { items: await this.workspace.resolveLegacyFeedback(artifact, items), threads }
  }

  private async resolveDiscussionArtifact(input: DiscussionActionInput): Promise<Artifact> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const root = await this.deps.feedbacks.findById(input.feedbackId)
    if (
      !root ||
      root.artifactId !== artifact.publicId ||
      !isAnnotationKind(root.kind) ||
      (root.draft && !input.includeDrafts)
    )
      throw new NotFoundError('未找到可访问的批注线程')
    return artifact
  }

  async replyToAnnotation(
    input: DiscussionActionInput & { body: string },
  ): Promise<AnnotationReply> {
    const artifact = await this.resolveDiscussionArtifact(input)
    const reply: AnnotationReply = {
      id: this.deps.ids.id('reply'),
      author: input.author,
      body: input.body,
      createdAt: this.deps.clock.now(),
    }
    await this.deps.feedbacks.annotations.reply(input.feedbackId, reply)
    await this.deps.realtime.publish(
      { type: 'annotation.changed', artifactId: artifact.publicId },
      { projectId: artifact.projectId },
    )
    return reply
  }

  async resolveAnnotation(input: DiscussionActionInput & { resolved: boolean }): Promise<void> {
    const artifact = await this.resolveDiscussionArtifact(input)
    await this.deps.feedbacks.annotations.setResolution(
      input.feedbackId,
      input.resolved ? { author: input.author, resolvedAt: this.deps.clock.now() } : null,
    )
    await this.deps.realtime.publish(
      { type: 'annotation.changed', artifactId: artifact.publicId },
      { projectId: artifact.projectId },
    )
  }
}
