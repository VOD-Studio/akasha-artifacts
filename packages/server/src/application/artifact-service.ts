import type {
  Artifact,
  ArtifactIdentifier,
  ArtifactType,
  Author,
  ElementRef,
  Feedback,
  FeedbackKind,
  JsonPatchOp,
  Project,
  PublicId,
  ReviewGroup,
  ReviewRound,
  Slug,
  StateStreamSnapshot,
  TextEdit,
  Verdict,
  Version,
  Visibility,
} from '@akasha/protocol'
import { PublicIdSchema } from '@akasha/protocol'
import {
  applyTextEdits,
  assertBaseVersion,
  createImmutableVersion,
} from '../domain/artifact/index.js'
import { DomainError, InvalidReceiptError, NotFoundError } from '../domain/errors.js'
import { isDraftFeedback, shouldNotifyImmediately } from '../domain/feedback/index.js'
import type {
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  ProjectRepository,
  RealtimePublisher,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../domain/ports.js'
import {
  applyGroupDecision,
  closeActiveRounds,
  createReviewRound,
  submitReviewRound,
  withdrawReviewRound,
} from '../domain/round/index.js'
import { applyJsonPatch, replayStateStream } from '../domain/state/index.js'

export interface ArtifactServiceDeps {
  projects: ProjectRepository
  artifacts: ArtifactRepository
  states: StateRepository
  rounds: RoundRepository
  feedbacks: FeedbackRepository
  receipts: ReceiptRepository
  realtime: RealtimePublisher
  clock: Clock
  ids: IdGenerator
}

const DEFAULT_PROJECT_ID = 'default'

export class ArtifactService {
  constructor(private readonly deps: ArtifactServiceDeps) {}

  async registerProject(input: { id?: string; rootPath: string; name: string }): Promise<Project> {
    const existing = await this.deps.projects.findByRootPath(input.rootPath)
    const now = this.deps.clock.now()
    const project: Project = {
      id: existing?.id ?? input.id ?? this.deps.ids.id('proj'),
      rootPath: input.rootPath,
      name: input.name.trim() || input.rootPath,
      lastActiveAt: now,
    }
    return this.deps.projects.upsert(project)
  }

  async resolveArtifact(
    identifier: ArtifactIdentifier,
    projectId = DEFAULT_PROJECT_ID,
  ): Promise<Artifact> {
    if (PublicIdSchema.safeParse(identifier).success) {
      const byPublic = await this.deps.artifacts.findByPublicId(identifier)
      if (byPublic) return byPublic
    }
    const bySlug = await this.deps.artifacts.findBySlug(projectId, identifier)
    if (!bySlug) {
      throw new NotFoundError(`未找到 Artifact "${identifier}"`, { identifier, projectId })
    }
    return bySlug
  }

  async publish(input: {
    projectId?: string
    slug: Slug
    title: string
    type: ArtifactType
    source: string
    baseVersion?: number
    visibility?: Visibility
    author: Author
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const projectId = input.projectId ?? DEFAULT_PROJECT_ID
    const now = this.deps.clock.now()
    const existing = await this.deps.artifacts.findBySlug(projectId, input.slug)

    if (!existing) {
      const publicId = this.deps.ids.publicId()
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
      await this.deps.artifacts.appendVersion(version)
      await this.deps.states.saveSnapshot({
        artifactId: publicId,
        seq: 0,
        snapshot: {},
        updatedAt: now,
      })
      await this.deps.realtime.publish({
        type: 'version.created',
        artifactId: publicId,
        version,
      })
      return { artifact, version }
    }

    const versions = await this.deps.artifacts.getVersions(existing.publicId)
    assertBaseVersion(existing, versions, input.baseVersion)

    const nextNumber = existing.headVersion + 1
    const version = createImmutableVersion({
      artifactId: existing.publicId,
      version: nextNumber,
      parentVersion: existing.headVersion,
      author: input.author,
      title: input.title.trim() || existing.title,
      source: input.source,
      createdAt: now,
    })
    const updated: Artifact = {
      ...existing,
      title: version.title,
      type: input.type,
      visibility: input.visibility ?? existing.visibility,
      headVersion: nextNumber,
      updatedAt: now,
    }
    await this.deps.artifacts.appendVersion(version)
    await this.deps.artifacts.saveArtifact(updated)
    await this.deps.realtime.publish({
      type: 'version.created',
      artifactId: updated.publicId,
      version,
    })
    return { artifact: updated, version }
  }

  async update(input: {
    id: ArtifactIdentifier
    projectId?: string
    baseVersion: number
    title?: string
    edits: readonly TextEdit[]
    author: Author
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const existing = await this.resolveArtifact(input.id, input.projectId)
    const versions = await this.deps.artifacts.getVersions(existing.publicId)
    assertBaseVersion(existing, versions, input.baseVersion)

    const head = versions.find((v) => v.version === existing.headVersion)
    if (!head) {
      throw new NotFoundError(`缺少头版本 v${existing.headVersion}`)
    }
    const nextSource = applyTextEdits(head.source, input.edits)
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
    await this.deps.artifacts.appendVersion(version)
    await this.deps.artifacts.saveArtifact(updated)
    await this.deps.realtime.publish({
      type: 'version.created',
      artifactId: updated.publicId,
      version,
    })
    return { artifact: updated, version }
  }

  // 回退历史版本同样作为一次新写入，不覆盖或篡改既有不可变版本历史。
  async revert(input: {
    id: ArtifactIdentifier
    projectId?: string
    targetVersion: number
    baseVersion: number
    author: Author
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const existing = await this.resolveArtifact(input.id, input.projectId)
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
      title: target.title,
      source: target.source,
      createdAt: now,
    })
    const updated: Artifact = {
      ...existing,
      title: version.title,
      headVersion: nextNumber,
      updatedAt: now,
    }
    await this.deps.artifacts.appendVersion(version)
    await this.deps.artifacts.saveArtifact(updated)
    await this.deps.realtime.publish({
      type: 'version.created',
      artifactId: updated.publicId,
      version,
    })
    return { artifact: updated, version }
  }

  async pushState(input: {
    id: ArtifactIdentifier
    projectId?: string
    ops: readonly JsonPatchOp[]
  }): Promise<StateStreamSnapshot> {
    if (input.ops.length === 0) {
      throw new DomainError('BAD_REQUEST', '状态补丁 ops 不能为空')
    }
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const now = this.deps.clock.now()
    const current = (await this.deps.states.getSnapshot(artifact.publicId)) ?? {
      artifactId: artifact.publicId,
      seq: 0,
      snapshot: {},
      updatedAt: now,
    }
    const nextData = applyJsonPatch(current.snapshot, input.ops)
    const nextSeq = current.seq + 1
    const nextSnapshot: StateStreamSnapshot = {
      artifactId: artifact.publicId,
      seq: nextSeq,
      snapshot: nextData,
      updatedAt: now,
    }
    await this.deps.states.appendPatch(artifact.publicId, {
      seq: nextSeq,
      ops: structuredClone(input.ops) as JsonPatchOp[],
      createdAt: now,
    })
    await this.deps.states.saveSnapshot(nextSnapshot)
    await this.deps.realtime.publish({
      type: 'state.patched',
      artifactId: artifact.publicId,
      stateSeq: nextSeq,
      ops: structuredClone(input.ops) as JsonPatchOp[],
    })
    return nextSnapshot
  }

  async getStateAt(input: {
    id: ArtifactIdentifier
    projectId?: string
    seq?: number
  }): Promise<{ artifactId: PublicId; seq: number; snapshot: Record<string, unknown> }> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const patches = await this.deps.states.getPatches(artifact.publicId)
    const replayed = replayStateStream(patches, input.seq)
    return { artifactId: artifact.publicId, ...replayed }
  }

  async getArtifact(input: {
    id: ArtifactIdentifier
    projectId?: string
    version?: number
  }): Promise<{
    artifact: Artifact
    version: Readonly<Version>
    state: StateStreamSnapshot
    rounds: readonly ReviewRound[]
  }> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const targetNum = input.version ?? artifact.headVersion
    const version = await this.deps.artifacts.getVersion(artifact.publicId, targetNum)
    if (!version) {
      throw new NotFoundError(`未找到版本 v${targetNum}`)
    }
    const state = (await this.deps.states.getSnapshot(artifact.publicId)) ?? {
      artifactId: artifact.publicId,
      seq: 0,
      snapshot: {},
      updatedAt: artifact.updatedAt,
    }
    const rounds = await this.deps.rounds.listByArtifact(artifact.publicId)
    return { artifact, version, state, rounds }
  }

  async getHistory(
    id: ArtifactIdentifier,
    projectId?: string,
  ): Promise<readonly Readonly<Version>[]> {
    const artifact = await this.resolveArtifact(id, projectId)
    return this.deps.artifacts.getVersions(artifact.publicId)
  }

  async openRound(input: {
    id: ArtifactIdentifier
    projectId?: string
    groups: ReviewGroup[]
  }): Promise<ReviewRound> {
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
    await this.deps.realtime.publish({
      type: 'round.updated',
      artifactId: artifact.publicId,
      round,
    })
    return round
  }

  async recordDecision(input: {
    id: ArtifactIdentifier
    projectId?: string
    roundId?: string
    groupId?: string
    choice?: string | null
    verdict?: Verdict
    note?: string
    submitRound?: boolean
    fromAgent?: boolean
  }): Promise<ReviewRound> {
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
    await this.deps.realtime.publish({
      type: 'round.updated',
      artifactId: artifact.publicId,
      round: next,
    })
    return next
  }

  async submitRound(input: {
    id: ArtifactIdentifier
    projectId?: string
    roundId: string
  }): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const round = await this.deps.rounds.findById(artifact.publicId, input.roundId)
    if (!round) {
      throw new NotFoundError(`未找到轮次 "${input.roundId}"`)
    }
    const now = this.deps.clock.now()
    const submitted = submitReviewRound(round, now)
    await this.deps.feedbacks.promoteRoundDrafts(artifact.publicId, submitted.id, now)
    await this.deps.rounds.saveRound(submitted)
    await this.deps.realtime.publish({
      type: 'round.updated',
      artifactId: artifact.publicId,
      round: submitted,
    })
    return submitted
  }

  async withdrawRound(input: {
    id: ArtifactIdentifier
    projectId?: string
    roundId: string
  }): Promise<ReviewRound> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const round = await this.deps.rounds.findById(artifact.publicId, input.roundId)
    if (!round) {
      throw new NotFoundError(`未找到轮次 "${input.roundId}"`)
    }
    const withdrawn = withdrawReviewRound(round)
    await this.deps.rounds.saveRound(withdrawn)
    await this.deps.realtime.publish({
      type: 'round.updated',
      artifactId: artifact.publicId,
      round: withdrawn,
    })
    return withdrawn
  }

  async submitFeedback(input: {
    id: ArtifactIdentifier
    projectId?: string
    version: number
    roundId?: string | null
    groupId?: string | null
    kind: FeedbackKind
    element?: ElementRef | null
    body: string
    author: Author
  }): Promise<Feedback> {
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
      id: this.deps.ids.id('fb'),
      artifactId: artifact.publicId,
      version: input.version,
      roundId: input.roundId ?? null,
      groupId: input.groupId ?? null,
      kind: input.kind,
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
      await this.deps.realtime.publish({
        type: 'feedback.created',
        artifactId: artifact.publicId,
        feedback,
      })
    }
    return feedback
  }

  async pullFeedback(input: {
    id?: ArtifactIdentifier
    projectId?: string
    after?: string
    includeDrafts?: boolean
    detail?: boolean
  }): Promise<{
    items: readonly Feedback[]
    rounds: readonly ReviewRound[]
    cursor: string
    receipt?: string
  }> {
    const artifact = input.id ? await this.resolveArtifact(input.id, input.projectId) : undefined
    const items = await this.deps.feedbacks.list({
      artifactId: artifact?.publicId,
      afterId: input.after,
      includeDrafts: input.includeDrafts ?? false,
    })
    const rounds = artifact ? await this.deps.rounds.listByArtifact(artifact.publicId) : []
    const cursor = items.at(-1)?.id ?? input.after ?? ''
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

  async ackFeedback(input: {
    receipt: string
    resolveIds?: readonly string[]
  }): Promise<{ acknowledged: number; resolved: number }> {
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
      await this.deps.realtime.publish({
        type: 'feedback.updated',
        artifactId: updated.artifactId,
        feedback: updated,
      })
    }

    return { acknowledged, resolved }
  }
}
