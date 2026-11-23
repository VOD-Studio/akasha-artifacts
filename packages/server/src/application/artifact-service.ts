import { applyVisualEdit, inspectVisualTarget, VisualEditError } from '@akasha/jsx-source/edit'
import type {
  Artifact,
  ArtifactIdentifier,
  ArtifactType,
  Author,
  EditOp,
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
import { visualBoardSource } from './artboard-visual-source.js'
import { KeyedAsyncLock } from './keyed-lock.js'

/** 用例依赖的端口集合，全部经构造参数注入。 */
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
const VISUAL_EDIT_LABEL = '可视化直改：'
const VISUAL_EDIT_FEEDBACK_PREFIX = 'visualedit'
const VISUAL_UNDO_LABEL = '撤销可视化直改 v'
const VISUAL_EDIT_KIND_LABEL = {
  text: '修改文字',
  className: '调整 Tailwind 类名',
  attr: '修改属性',
  move: '调整兄弟元素顺序',
  remove: '删除元素',
} satisfies Record<EditOp['kind'], string>

interface VisualEditBase {
  id: ArtifactIdentifier
  projectId?: string
  baseVersion: number
}

type VisualEditCommand = { op: EditOp; boardId?: string } | { undoVersion: number }

/**
 * 制品用例编排：发布、增量更新、回退、状态流、评审轮次与反馈队列。
 *
 * @remarks 版本写入与状态流补丁各自按制品串行化：同一制品的读-检-写不会交错，
 * 不同制品互不阻塞。
 */
export class ArtifactService {
  // 分别串行化同一 Artifact 的版本写入与状态流补丁，避免并发读-检-写竞态
  private readonly writeLocks = new KeyedAsyncLock()
  private readonly stateLocks = new KeyedAsyncLock()

  constructor(private readonly deps: ArtifactServiceDeps) {}

  /** 登记项目；同一 `rootPath` 重复登记时沿用既有 `id`。 */
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

  /**
   * 在与 `publish`、`update`、`revert` 相同的制品写锁内执行 `fn`。
   *
   * @remarks 供本地文件存储对账元数据（如目录改名）时使用，
   * 避免并发回写过期的 `headVersion`。
   */
  withArtifactLock<T>(publicId: PublicId, fn: () => Promise<T>): Promise<T> {
    return this.writeLocks.run(`artifact:${publicId}`, fn)
  }

  /**
   * 把 `publicId` 或 `slug` 解析成制品。
   *
   * @throws {NotFoundError} 解析不到，或未指定项目时同名 slug 命中多个制品。
   */
  async resolveArtifact(identifier: ArtifactIdentifier, projectId?: string): Promise<Artifact> {
    if (PublicIdSchema.safeParse(identifier).success) {
      const byPublic = await this.deps.artifacts.findByPublicId(identifier)
      if (byPublic) return byPublic
    }
    const targetProject = projectId ?? DEFAULT_PROJECT_ID
    const bySlug = await this.deps.artifacts.findBySlug(targetProject, identifier)
    if (bySlug) return bySlug

    // 未显式指定项目时，兼容跨项目按旧 slug 解析（仅当唯一命中时放行）
    if (!projectId) {
      const all = await this.deps.artifacts.listByProject()
      const matches = all.filter((a) => a.slug === identifier)
      if (matches.length === 1 && matches[0]) {
        return matches[0]
      }
    }

    throw new NotFoundError(`未找到 Artifact "${identifier}"`, {
      identifier,
      projectId: targetProject,
    })
  }

  /**
   * 新建制品，或对已有制品整体替换源码并生成新版本。
   *
   * @remarks 以「项目 + slug」为锁键串行化，命中已有制品后再进入该制品的写锁。
   * 新建时写入 v1 与初始空状态快照。
   * @throws {DomainError} 制品已存在而未传 `baseVersion`；错误码为 `BAD_REQUEST`。
   * @throws {VersionConflictError} `baseVersion` 落后于头版本。
   */
  async publish(input: {
    projectId?: string
    slug: Slug
    title: string
    type: ArtifactType
    source: string
    baseVersion?: number
    visibility?: Visibility
    author: Author
    // 仅供本地文件存储重建索引时沿用 .artifact-id 既有稳定 publicId，不对外部 HTTP/MCP 协议暴露
    preferredPublicId?: PublicId
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const projectId = input.projectId ?? DEFAULT_PROJECT_ID
    const slugLockKey = `slug:${projectId}::${input.slug}`

    return this.writeLocks.run(slugLockKey, async () => {
      const existing = await this.deps.artifacts.findBySlug(projectId, input.slug)
      const now = this.deps.clock.now()

      if (!existing) {
        let publicId: PublicId
        if (input.preferredPublicId && PublicIdSchema.safeParse(input.preferredPublicId).success) {
          const taken = await this.deps.artifacts.findByPublicId(input.preferredPublicId)
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
        await this.deps.artifacts.appendVersion(version)
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
      return this.writeLocks.run(`artifact:${existing.publicId}`, async () => {
        const fresh = await this.deps.artifacts.findByPublicId(existing.publicId)
        if (!fresh) {
          throw new NotFoundError(`未找到 Artifact "${existing.publicId}"`)
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
        await this.deps.artifacts.appendVersion(version)
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

  /**
   * 在头版本源码上按序应用增量替换，生成新版本。
   *
   * @remarks 失败方式见 `applyTextEdits`；任一条编辑失败则不写入任何版本。
   * @throws {NotFoundError} 制品或其头版本不存在。
   * @throws {VersionConflictError} `baseVersion` 不等于头版本。
   */
  async update(input: {
    id: ArtifactIdentifier
    projectId?: string
    baseVersion: number
    title?: string
    edits: readonly TextEdit[]
    author: Author
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.writeLocks.run(`artifact:${resolved.publicId}`, async () => {
      const existing = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!existing) {
        throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      }
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

  /** 查询某个 `loc` 能否直改；不带 `loc` 时返回当前可撤销的版本号。 */
  async inspectVisualEdit(input: VisualEditBase & { loc?: string; boardId?: string }) {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const head = await this.visualEditHead(artifact, input.baseVersion)
    if (input.loc) {
      if (input.boardId === undefined)
        return { target: inspectVisualTarget(artifact.type, head.source, input.loc) }
      const board =
        artifact.type === 'artboard'
          ? visualBoardSource(head.source, head.version, input.boardId)
          : null
      return { target: board ? inspectVisualTarget('html', board.html, input.loc) : null }
    }
    return { undoVersion: (await this.findVisualUndo(artifact, head))?.version ?? null }
  }

  /** 只计算直改后的源码，供沙盒乐观预览；不写入版本。 */
  async previewVisualEdit(input: VisualEditBase & VisualEditCommand): Promise<string> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const head = await this.visualEditHead(artifact, input.baseVersion)
    return this.visualEditSource(artifact, head, input)
  }

  /**
   * 应用一次可视化直改或撤销，生成新版本并自动写入一条 `kind=edit` 的反馈。
   *
   * @remarks 改写后源码与头版本相同时不产生新版本。反馈的 `id` 带 `visualedit_` 前缀，
   * 撤销链据此识别连续的直改。
   * @throws {DomainError} `author` 不是人类；错误码为 `FORBIDDEN`。
   */
  async visualEdit(input: VisualEditBase & VisualEditCommand & { author: Author }) {
    if (!input.author.startsWith('human:')) {
      throw new DomainError('FORBIDDEN', '可视化直改仅支持人类作者')
    }
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.withArtifactLock(resolved.publicId, async () => {
      const artifact = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!artifact) throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      const head = await this.visualEditHead(artifact, input.baseVersion)
      const source = await this.visualEditSource(artifact, head, input)
      if (source === head.source) return { artifact, version: head }
      const now = this.deps.clock.now()
      const version = createImmutableVersion({
        artifactId: artifact.publicId,
        version: head.version + 1,
        parentVersion: head.version,
        author: input.author,
        title: head.title,
        source,
        createdAt: now,
      })
      const updated = { ...artifact, headVersion: version.version, updatedAt: now }
      await this.deps.artifacts.appendVersion(version)
      await this.deps.artifacts.saveArtifact(updated)
      await this.submitFeedback(
        {
          id: updated.publicId,
          projectId: updated.projectId,
          version: version.version,
          kind: 'edit',
          // loc 属于基准源码；写入新版本后位置可能漂移，不把它当作新版本的图钉。
          body:
            'op' in input
              ? `${VISUAL_EDIT_LABEL}${VISUAL_EDIT_KIND_LABEL[input.op.kind]}（v${head.version}，${input.op.loc}）`
              : `${VISUAL_UNDO_LABEL}${input.undoVersion}`,
          author: input.author,
        },
        VISUAL_EDIT_FEEDBACK_PREFIX,
      )
      await this.deps.realtime.publish(
        { type: 'version.created', artifactId: updated.publicId, version },
        { projectId: updated.projectId },
      )
      return { artifact: updated, version }
    })
  }

  private async visualEditHead(
    artifact: Artifact,
    baseVersion: number,
  ): Promise<Readonly<Version>> {
    if (baseVersion !== artifact.headVersion) {
      assertBaseVersion(
        artifact,
        await this.deps.artifacts.getVersions(artifact.publicId),
        baseVersion,
      )
    }
    const head = await this.deps.artifacts.getVersion(artifact.publicId, artifact.headVersion)
    if (!head) throw new NotFoundError(`缺少头版本 v${artifact.headVersion}`)
    return head
  }

  private async visualEditSource(
    artifact: Artifact,
    head: Readonly<Version>,
    command: VisualEditCommand,
  ): Promise<string> {
    if ('op' in command) {
      try {
        if (command.boardId !== undefined) {
          const board =
            artifact.type === 'artboard' && command.op.kind === 'text'
              ? visualBoardSource(head.source, head.version, command.boardId)
              : null
          if (!board) throw new VisualEditError('该画板仅支持直改静态文字')
          return board.replace(applyVisualEdit('html', board.html, command.op))
        }
        return applyVisualEdit(artifact.type, head.source, command.op)
      } catch (error) {
        if (!(error instanceof VisualEditError)) throw error
        throw new DomainError('BAD_REQUEST', error.message, { annotationOnly: true })
      }
    }
    const edited = await this.findVisualUndo(artifact, head)
    if (
      edited?.version !== command.undoVersion ||
      !edited.parentVersion ||
      edited.source !== head.source
    ) {
      throw new DomainError('BAD_REQUEST', '只能撤销当前源码中的最近一次直改')
    }
    const parent = await this.deps.artifacts.getVersion(artifact.publicId, edited.parentVersion)
    if (!parent) throw new NotFoundError(`缺少基准版本 v${edited.parentVersion}`)
    return parent.source
  }

  private async findVisualUndo(
    artifact: Artifact,
    head: Readonly<Version>,
  ): Promise<Readonly<Version> | undefined> {
    if (!head.parentVersion || (artifact.type !== 'react' && artifact.type !== 'html'))
      return undefined
    const { items } = await this.deps.feedbacks.list({ artifactId: artifact.publicId })
    const editNotes = new Map<number, string>()
    for (const item of items) {
      if (
        item.kind === 'edit' &&
        item.id.startsWith(`${VISUAL_EDIT_FEEDBACK_PREFIX}_`) &&
        item.version <= head.version
      ) {
        editNotes.set(item.version, item.body)
      }
    }
    const versions = await this.deps.artifacts.getVersions(artifact.publicId)
    const stack: Readonly<Version>[] = []
    // 任何普通发布、代码保存或历史回退都会打断直改撤销链。
    for (const version of [...versions].sort((a, b) => a.version - b.version)) {
      if (version.version > head.version) break
      const note = editNotes.get(version.version)
      if (note?.startsWith(VISUAL_EDIT_LABEL)) stack.push(version)
      else if (note === `${VISUAL_UNDO_LABEL}${stack.at(-1)?.version}`) stack.pop()
      else stack.length = 0
    }
    return stack.at(-1)
  }

  /**
   * 回退到历史版本：生成内容等于目标版本的新版本，不改动既有版本。
   *
   * @throws {NotFoundError} 目标版本不存在。
   * @throws {VersionConflictError} `baseVersion` 不等于头版本。
   */
  async revert(input: {
    id: ArtifactIdentifier
    projectId?: string
    targetVersion: number
    baseVersion: number
    author: Author
  }): Promise<{ artifact: Artifact; version: Readonly<Version> }> {
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.writeLocks.run(`artifact:${resolved.publicId}`, async () => {
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

  /**
   * 向状态流追加一条补丁并推进快照；不参与版本冲突检测。
   *
   * @remarks 按制品串行化，补丁总是作用于最新状态。落库顺序为补丁日志、快照，最后广播
   * `state.patched`。
   * @throws {StatePatchError} 补丁应用失败，此时状态流不变。
   */
  async pushState(input: {
    id: ArtifactIdentifier
    projectId?: string
    ops: readonly JsonPatchOp[]
  }): Promise<StateStreamSnapshot> {
    if (input.ops.length === 0) {
      throw new DomainError('BAD_REQUEST', '状态补丁 ops 不能为空')
    }
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    return this.stateLocks.run(artifact.publicId, async () => {
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
      await this.deps.realtime.publish(
        {
          type: 'state.patched',
          artifactId: artifact.publicId,
          stateSeq: nextSeq,
          ops: structuredClone(input.ops) as JsonPatchOp[],
        },
        { projectId: artifact.projectId },
      )
      return nextSnapshot
    })
  }

  /** 回放补丁日志得到指定 `seq` 处的状态；省略 `seq` 时为最新状态。 */
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

  /** 读取制品元数据、指定版本（缺省为头版本）、最新状态快照与全部轮次。 */
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

  /** 开启新一轮：此前未关闭的轮次自动转为 `closed`。 */
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

  /**
   * 把一次分组决定写入轮次，可同时提交本轮。
   *
   * @remarks `roundId` 省略时作用于最新一轮；`groupId` 省略时只做提交。
   * `fromAgent` 为 true 时允许改写非 `drafting` 轮次，用于回写终端里的口头答复。
   * @throws {NotFoundError} 没有可用的轮次。
   */
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

  /** 提交轮次并把本轮草稿转为可投递，随后广播 `round.updated`。 */
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

  /** 撤回已提交的轮次，回到 `drafting`；已转正的草稿不会退回。 */
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

  /**
   * 写入一条反馈；所属轮次处于 `drafting` 时标记为草稿。
   *
   * @remarks 草稿照常落库但不广播，非草稿广播 `feedback.created`。`idPrefix` 区分来源，
   * 可视化直改传入 `visualedit`。
   * @throws {NotFoundError} 反馈绑定的版本不存在。
   */
  async submitFeedback(
    input: {
      id: ArtifactIdentifier
      projectId?: string
      version: number
      roundId?: string | null
      groupId?: string | null
      kind: FeedbackKind
      element?: ElementRef | null
      body: string
      author: Author
    },
    idPrefix = 'fb',
  ): Promise<Feedback> {
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
    }
    return feedback
  }

  /**
   * 非阻塞拉取反馈。
   *
   * @remarks 未指定 `id` 而指定 `projectId` 时，范围限定为该项目内的全部制品。
   * 只有 `detail` 为真且有结果时才签发回执。
   */
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

    // 未指定具体 artifact 但指定了 projectId 时，严格限定在项目所属的 Artifact 集合内
    let artifactIds: Set<PublicId> | undefined
    if (!artifact && input.projectId) {
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

  /**
   * 凭回执确认消费：回执覆盖的反馈转为 `delivered`，`resolveIds` 中的转为 `resolved`。
   *
   * @returns 实际更新的条数，以及其中被标记为 `resolved` 的条数。
   * @throws {InvalidReceiptError} 回执不存在或已被消费。
   */
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
