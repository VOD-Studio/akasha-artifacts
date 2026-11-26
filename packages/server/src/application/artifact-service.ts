import type { ArtifactIdentifier, ArtifactTransferInput, Author, PublicId } from '@akasha/protocol'
import type {
  AnnotationAgentDispatcher,
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
import type { ArtifactWorkspaceRead } from './artifact-workspace-read.js'
import { ArtifactLifecycle, type RenameArtifactInput } from './artifacts/lifecycle.js'
import { ArtifactQueries, type ArtifactVersionQuery } from './artifacts/queries.js'
import {
  ArtifactStateStream,
  type PushStateInput,
  type StateQuery,
} from './artifacts/state-stream.js'
import {
  ArtifactVersions,
  type CanvasEditInput,
  type PublishArtifactInput,
  type RevertArtifactInput,
  type UpdateArtifactInput,
} from './artifacts/versions.js'
import {
  ArtifactVisualEdit,
  type VisualEditBase,
  type VisualEditCommand,
} from './artifacts/visual-edit.js'
import { ArtifactWriteLocks } from './artifacts/write-locks.js'
import { DesignSystems } from './design-systems/service.js'
import { type RegisterProjectInput, registerProject } from './projects.js'
import {
  type DiscussionActionInput,
  ReviewFeedback,
  type ReviewFeedbackQuery,
  type SubmitFeedbackInput,
} from './review/feedback.js'
import {
  type AckFeedbackInput,
  FeedbackDelivery,
  type PullFeedbackInput,
} from './review/feedback-delivery.js'
import {
  type OpenRoundInput,
  type RecordDecisionInput,
  ReviewRounds,
  type RoundReference,
} from './review/rounds.js'

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
  /** 仅本机受管 Agent 装配时注入，用于将显式投递的批注路由至已绑定会话。 */
  annotationAgent?: AnnotationAgentDispatcher
}

/**
 * 制品用例编排：发布、增量更新、回退、状态流、评审轮次与反馈队列。
 *
 * @remarks 版本写入与状态流补丁各自按制品串行化：同一制品的读-检-写不会交错，
 * 不同制品互不阻塞。
 */
export class ArtifactService {
  readonly workspace: ArtifactWorkspaceRead
  readonly designSystems: DesignSystems
  private readonly writeLocks = new ArtifactWriteLocks()
  private readonly queries: ArtifactQueries
  private readonly versions: ArtifactVersions
  private readonly lifecycle: ArtifactLifecycle
  private readonly visual: ArtifactVisualEdit
  private readonly state: ArtifactStateStream
  private readonly rounds: ReviewRounds
  private readonly feedback: ReviewFeedback
  private readonly delivery: FeedbackDelivery

  constructor(private readonly deps: ArtifactServiceDeps) {
    this.queries = new ArtifactQueries(deps)
    this.workspace = this.queries.workspace
    const resolve = this.queries.resolveArtifact.bind(this.queries)
    this.versions = new ArtifactVersions(deps, resolve, this.writeLocks)
    this.designSystems = new DesignSystems(deps.artifacts, this.versions)
    this.lifecycle = new ArtifactLifecycle(deps, resolve, this.writeLocks, this.versions)
    this.feedback = new ReviewFeedback(deps, resolve, this.workspace)
    this.visual = new ArtifactVisualEdit(deps, resolve, this.writeLocks, this.feedback)
    this.state = new ArtifactStateStream(deps, resolve)
    this.rounds = new ReviewRounds(deps, resolve)
    this.delivery = new FeedbackDelivery(deps, resolve)
  }

  /** 登记项目；同一 `rootPath` 重复登记时沿用既有 `id`。 */
  registerProject(input: RegisterProjectInput) {
    return registerProject(this.deps, input)
  }

  /**
   * 在与 `publish`、`update`、`revert` 相同的制品写锁内执行 `fn`。
   *
   * @remarks 供本地文件存储对账元数据（如目录改名）时使用，
   * 避免并发回写过期的 `headVersion`。
   */
  withArtifactLock<T>(publicId: PublicId, fn: () => Promise<T>): Promise<T> {
    return this.writeLocks.forArtifact(publicId, fn)
  }

  /**
   * 把 `publicId` 或 `slug` 解析成制品。
   *
   * @throws {NotFoundError} 解析不到，或未指定项目时同名 slug 命中多个制品。
   */
  resolveArtifact(identifier: ArtifactIdentifier, projectId?: string) {
    return this.queries.resolveArtifact(identifier, projectId)
  }

  /**
   * 新建制品，或对已有制品整体替换源码并生成新版本。
   *
   * @remarks 以「项目 + slug」为锁键串行化，命中已有制品后再进入该制品的写锁。
   * 新建时写入 v1 与初始空状态快照。
   * @throws {DomainError} 制品已存在而未传 `baseVersion`；错误码为 `BAD_REQUEST`。
   * @throws {VersionConflictError} `baseVersion` 落后于头版本。
   */
  publish(input: PublishArtifactInput) {
    return this.versions.publish(input)
  }

  /**
   * 在头版本源码上按序应用增量替换，生成新版本。
   *
   * @remarks 失败方式见 `applyTextEdits`；任一条编辑失败则不写入任何版本。
   * @throws {NotFoundError} 制品或其头版本不存在。
   * @throws {VersionConflictError} `baseVersion` 不等于头版本。
   */
  update(input: UpdateArtifactInput) {
    return this.versions.update(input)
  }

  /** 在写锁内按 Hub 当前授权合并画布草稿，保留其他编辑者已提交的内容。 */
  editCanvas(input: CanvasEditInput) {
    return this.versions.editCanvas(input)
  }

  /**
   * 回退到历史版本：生成内容等于目标版本的新版本，不改动既有版本。
   *
   * @throws {NotFoundError} 目标版本不存在。
   * @throws {VersionConflictError} `baseVersion` 不等于头版本。
   */
  revert(input: RevertArtifactInput) {
    return this.versions.revert(input)
  }

  /** 只修改制品展示标题，历史快照以及其 permalink 保持不变。 */
  renameArtifact(input: RenameArtifactInput) {
    return this.lifecycle.renameArtifact(input)
  }

  /** 只复制所选源码快照，或在服务内原子移动既有标识。 */
  transferArtifact(id: ArtifactIdentifier, input: ArtifactTransferInput, author: Author) {
    return this.lifecycle.transferArtifact(id, input, author)
  }

  /** 软撤下和恢复只更改可见性层，不重建源码、版本或反馈。 */
  setArtifactWithdrawal(publicId: PublicId, withdrawn: boolean) {
    return this.lifecycle.setArtifactWithdrawal(publicId, withdrawn)
  }

  /** 查询某个 `loc` 能否直改；不带 `loc` 时返回当前可撤销的版本号。 */
  inspectVisualEdit(input: VisualEditBase & { loc?: string; boardId?: string }) {
    return this.visual.inspectVisualEdit(input)
  }

  /** 只计算直改后的源码，供沙盒乐观预览；不写入版本。 */
  previewVisualEdit(input: VisualEditBase & VisualEditCommand) {
    return this.visual.previewVisualEdit(input)
  }

  /**
   * 应用一次可视化直改或撤销，生成新版本并自动写入一条 `kind=edit` 的反馈。
   *
   * @remarks 改写后源码与头版本相同时不产生新版本。反馈的 `id` 带 `visualedit_` 前缀，
   * 撤销链据此识别连续的直改。
   * @throws {DomainError} `author` 不是人类；错误码为 `FORBIDDEN`。
   */
  visualEdit(input: VisualEditBase & VisualEditCommand & { author: Author }) {
    return this.visual.visualEdit(input)
  }

  /** 读取制品元数据、指定版本（缺省为头版本）、最新状态快照与全部轮次。 */
  getArtifact(input: ArtifactVersionQuery) {
    return this.queries.getArtifact(input)
  }

  /** 工作区只打开布局索引；源码读取保留给编辑、导出和 Agent。 */
  getWorkspace(input: ArtifactVersionQuery) {
    return this.queries.getWorkspace(input)
  }

  getHistory(id: ArtifactIdentifier, projectId?: string) {
    return this.queries.getHistory(id, projectId)
  }

  /** 源码不会随版本菜单一起下载。 */
  getHistorySummaries(id: ArtifactIdentifier, projectId?: string) {
    return this.queries.getHistorySummaries(id, projectId)
  }

  /**
   * 向状态流追加一条补丁并推进快照；不参与版本冲突检测。
   *
   * @remarks 按制品串行化，补丁总是作用于最新状态。落库顺序为补丁日志、快照，最后广播
   * `state.patched`。
   * @throws {StatePatchError} 补丁应用失败，此时状态流不变。
   */
  pushState(input: PushStateInput) {
    return this.state.pushState(input)
  }

  /** 回放补丁日志得到指定 `seq` 处的状态；省略 `seq` 时为最新状态。 */
  getStateAt(input: StateQuery) {
    return this.state.getStateAt(input)
  }

  /** 开启新一轮：此前未关闭的轮次自动转为 `closed`。 */
  openRound(input: OpenRoundInput) {
    return this.rounds.openRound(input)
  }

  /**
   * 把一次分组决定写入轮次，可同时提交本轮。
   *
   * @remarks `roundId` 省略时作用于最新一轮；`groupId` 省略时只做提交。
   * `fromAgent` 为 true 时允许改写非 `drafting` 轮次，用于回写终端里的口头答复。
   * @throws {NotFoundError} 没有可用的轮次。
   */
  recordDecision(input: RecordDecisionInput) {
    return this.rounds.recordDecision(input)
  }

  /** 提交轮次并把本轮草稿转为可投递，随后广播 `round.updated`。 */
  submitRound(input: RoundReference) {
    return this.rounds.submitRound(input)
  }

  /** 撤回已提交的轮次，回到 `drafting`；已转正的草稿不会退回。 */
  withdrawRound(input: RoundReference) {
    return this.rounds.withdrawRound(input)
  }

  /**
   * 写入一条反馈；所属轮次处于 `drafting` 时标记为草稿。
   *
   * @remarks 只供讨论的意见和草稿不会唤醒 Agent。`idPrefix` 区分可视化直改的 `visualedit`。
   * @throws {NotFoundError} 反馈绑定的版本不存在。
   */
  submitFeedback(input: SubmitFeedbackInput, idPrefix = 'fb') {
    return this.feedback.submitFeedback(input, idPrefix)
  }

  /** 读取制品的审阅记录，不签发 Agent 消费回执。 */
  listFeedbackForReview(input: ReviewFeedbackQuery) {
    return this.feedback.listFeedbackForReview(input)
  }

  /** 回复保持根批注的版本与定位，不单独投递给 Agent。 */
  replyToAnnotation(input: DiscussionActionInput & { body: string }) {
    return this.feedback.replyToAnnotation(input)
  }

  /** 人工解决或重新打开讨论，不改变该批注的 Agent 投递状态。 */
  resolveAnnotation(input: DiscussionActionInput & { resolved: boolean }) {
    return this.feedback.resolveAnnotation(input)
  }

  /**
   * 非阻塞拉取反馈。
   *
   * @remarks 未指定 `id` 而指定 `projectId` 时，范围限定为该项目内的全部制品。
   * 只有 `detail` 为真且有结果时才签发回执。
   */
  pullFeedback(input: PullFeedbackInput) {
    return this.delivery.pullFeedback(input)
  }

  /**
   * 凭回执确认消费：回执覆盖的反馈转为 `delivered`，`resolveIds` 中的转为 `resolved`。
   *
   * @returns 实际更新的条数，以及其中被标记为 `resolved` 的条数。
   * @throws {InvalidReceiptError} 回执不存在或已被消费。
   */
  ackFeedback(input: AckFeedbackInput) {
    return this.delivery.ackFeedback(input)
  }
}
