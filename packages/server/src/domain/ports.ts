import type {
  AnnotationAgentDelivery,
  AnnotationAgentState,
  AnnotationReply,
  AnnotationResolution,
  AnnotationThread,
  ArtboardContent,
  ArtboardIndex,
  ArtboardProjection,
  Artifact,
  ArtifactType,
  Feedback,
  Project,
  PublicId,
  RealtimeServerEvent,
  Receipt,
  ReviewRound,
  Slug,
  StatePatchEntry,
  StateStreamSnapshot,
  Version,
  VersionSummary,
  WithdrawnArtifact,
} from '@akasha/protocol'

/** 项目登记表的仓储端口；同一 `rootPath` 只对应一条记录。 */
export interface ProjectRepository {
  /** 插入或按 `id` 整体覆盖。 */
  upsert(project: Project): Promise<Project>
  findById(id: string): Promise<Project | undefined>
  /** 登记时用来识别重复的仓库根目录。 */
  findByRootPath(rootPath: string): Promise<Project | undefined>
  list(): Promise<readonly Project[]>
  /** 返回是否真的删除了记录。 */
  remove(id: string): Promise<boolean>
}

/** 一次原子的项目归属切换。 */
export interface ArtifactRelocation {
  /** 要保留原版本和链接的制品。 */
  publicId: PublicId
  /** 用作更新条件，避免向已改变归属的资源重复应用移动。 */
  sourceProjectId: string
  /** 已在当前服务登记的目标项目。 */
  targetProjectId: string
  /** 移动只更新归属和此时间。 */
  updatedAt: string
}

/** 撤下保留记录与唯一键，清除撤下状态不清除分享代数。 */
export interface ArtifactLifecycleRepository {
  /** 活动转撤下时递增分享代数；`null` 只恢复当前已撤下的制品。 */
  setWithdrawal(id: PublicId, at: string | null): Promise<boolean>
  findWithdrawn(id: PublicId): Promise<WithdrawnArtifact | undefined>
  listWithdrawn(): Promise<readonly WithdrawnArtifact[]>
  /** 只为活动制品返回分享代数；初始为 0，撤下或切换「仅本人」后旧代数不再有效。 */
  activeShareGeneration(id: PublicId): Promise<number | undefined>
}

/** 版本派生数据只用于读取；可以从不可变的整稿重建。 */
export interface BoardProjectionRepository {
  /** `undefined` 表示尚未构建；`null` 表示该版本不能解析成可分页读取的画板。 */
  getIndex(artifactId: PublicId, version: number): Promise<ArtboardIndex | null | undefined>
  /** 仅查询指定版本的一块板；不存在时不回落到当前头版。 */
  getBoard(
    artifactId: PublicId,
    version: number,
    boardId: string,
  ): Promise<ArtboardContent | undefined>
  /** 幂等补建旧版本的索引和正文；二者对读者同时可见。 */
  save(artifactId: PublicId, version: number, projection: ArtboardProjection | null): Promise<void>
}

/** 随不可变版本原子保存的工程入口，独立于可公开预览的编译产物。 */
export interface WorkspaceComponent {
  path: string
  exportName: string
  source: string
}

/** 制品与其不可变版本历史的仓储端口。 */
export interface ArtifactRepository {
  readonly lifecycle: ArtifactLifecycleRepository
  /** 不直接暴露给 HTTP；读请求仍从活动制品及其权限进入。 */
  readonly boardProjections: BoardProjectionRepository
  /** 按 `publicId` 插入或更新；已有制品的项目归属只能经 `relocate` 更改。 */
  saveArtifact(artifact: Artifact): Promise<void>
  /** 单独更新展示标题与更新时间，不重写源码、版本或项目归属。 */
  renameTitle(id: PublicId, title: string, updatedAt: string): Promise<Artifact | undefined>
  /** 原子更新项目和唯一 slug 索引，冲突不修改任何记录。 */
  relocate(input: ArtifactRelocation): Promise<Artifact | undefined>
  findByPublicId(publicId: PublicId): Promise<Artifact | undefined>
  findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined>
  /** `projectId` 省略时跨项目列出全部。 */
  listByProject(projectId?: string): Promise<readonly Artifact[]>
  /** 重复版本拒写；随版本一并提交画板投影或编码工作区入口。 */
  appendVersion(
    version: Readonly<Version>,
    type?: ArtifactType,
    component?: WorkspaceComponent,
  ): Promise<void>
  getWorkspaceComponent(
    artifactId: PublicId,
    version: number,
  ): Promise<WorkspaceComponent | undefined>
  getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]>
  getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined>
  /** 只读历史元数据，不加载源码或访问其对象存储。筛选精确版本时最多返回一条。 */
  getVersionSummaries(artifactId: PublicId, version?: number): Promise<readonly VersionSummary[]>
}

/** 制品状态流的仓储端口：一份最新快照，加上按 `seq` 排列的补丁日志。 */
export interface StateRepository {
  /** 制品尚无快照时返回 `undefined`。 */
  getSnapshot(artifactId: PublicId): Promise<StateStreamSnapshot | undefined>
  saveSnapshot(snapshot: StateStreamSnapshot): Promise<void>
  /** 追加一条补丁；`seq` 由调用方分配，仓储不保证其单调。 */
  appendPatch(artifactId: PublicId, entry: StatePatchEntry): Promise<void>
  /** 返回 `seq` 大于 `afterSeq` 的补丁；省略时返回全部。 */
  getPatches(artifactId: PublicId, afterSeq?: number): Promise<readonly StatePatchEntry[]>
}

/** 评审轮次的仓储端口；轮次按制品隔离，`roundId` 须与 `artifactId` 一起定位。 */
export interface RoundRepository {
  /** 按 `id` 插入或整体覆盖。 */
  saveRound(round: ReviewRound): Promise<void>
  /** 整体替换某制品的轮次列表；关闭旧轮次并追加新轮次时使用。 */
  replaceRounds(artifactId: PublicId, rounds: readonly ReviewRound[]): Promise<void>
  findById(artifactId: PublicId, roundId: string): Promise<ReviewRound | undefined>
  listByArtifact(artifactId: PublicId): Promise<readonly ReviewRound[]>
}

/** 讨论仓储与消费队列分开，写入不改变 Agent 游标或回执状态。 */
export interface AnnotationRepository {
  list(artifactId: PublicId, includeDrafts: boolean): Promise<Record<string, AnnotationThread>>
  reply(feedbackId: string, reply: AnnotationReply): Promise<void>
  /** 重复解决保留首条解决记录；传 `null` 重新打开。 */
  setResolution(feedbackId: string, resolution: AnnotationResolution | null): Promise<void>
  /** 仅首次声明该批注的已绑定 Agent 投递记录；返回 false 表示已投递过，防止重复发送。 */
  claimAgentDelivery(feedbackId: string, delivery: AnnotationAgentDelivery): Promise<boolean>
  /** 更新已绑定 Agent 投递的执行状态、真实回复与发布版本。 */
  setAgentDelivery(feedbackId: string, delivery: AnnotationAgentDelivery): Promise<void>
  /** 仅当持久化记录仍匹配观测到的状态与更新时间时才更新；否则保留并返回当前已落库记录。 */
  compareAndSetAgentDelivery(
    feedbackId: string,
    expected: { state: AnnotationAgentState; updatedAt: string },
    next: AnnotationAgentDelivery,
  ): Promise<AnnotationAgentDelivery | undefined>
  /** 读取单条批注的已绑定 Agent 投递记录。 */
  getAgentDelivery(feedbackId: string): Promise<AnnotationAgentDelivery | undefined>
}

/** 将明确面向 Agent 的批注闭环投递到本机已绑定会话，并按需修复重启中断状态。 */
export interface AnnotationAgentDispatcher {
  /** 只在制品绑定了本机 Agent 会话时接管；未绑定或已投递过时直接返回。 */
  dispatchFeedback(artifact: Artifact, feedback: Feedback): Promise<void>
  /** 读审阅列表时将已无活动任务的残留 queued/running 标记为失败，不自动重发。 */
  reconcileDeliveries(artifact: Artifact, threads: Record<string, AnnotationThread>): Promise<void>
}

/** 反馈队列的仓储端口；游标即「可投递顺序号」。 */
export interface FeedbackRepository {
  /** 以反馈 ID 关联的讨论，不参与队列消费。 */
  readonly annotations: AnnotationRepository
  save(feedback: Feedback): Promise<void>
  findById(id: string): Promise<Feedback | undefined>
  /**
   * 按可投递顺序号升序返回；草稿附在末尾。
   *
   * @returns `cursor` 为本页最大的可投递顺序号，没有新条目时原样返回 `afterCursor`。
   */
  list(filter: {
    // 只列该制品的反馈
    artifactId?: PublicId
    // 只列这些制品的反馈；与 `artifactId` 同时给出时须两者都满足
    artifactIds?: ReadonlySet<PublicId>
    // 上次返回的 `cursor`；只返回顺序号在它之后的反馈
    afterCursor?: string
    // 只预览旧接口产生的草稿；显式投递的批注须等待所属轮次提交
    includeDrafts?: boolean
  }): Promise<{ items: readonly Feedback[]; cursor: string }>
  /** 审阅界面读取制品的所有批注；不产生游标或消费回执。 */
  listForReview(artifactId: PublicId, includeDrafts: boolean): Promise<readonly Feedback[]>
  /** 把轮次草稿转正；只为可投递的条目分配顺序号，返回转正的总条数。 */
  promoteRoundDrafts(artifactId: PublicId, roundId: string, updatedAt: string): Promise<number>
}

/** 读取回执的仓储端口。 */
export interface ReceiptRepository {
  save(receipt: Receipt): Promise<void>
  /** 取出并删除回执，因此只能消费一次；不存在时返回 `undefined`。 */
  consume(receiptId: string): Promise<Receipt | undefined>
}

/** 发布事件时的载荷：信封字段 `v`、`seq`、`timestamp` 由总线补齐。 */
export type RealtimeEventPayload<T = RealtimeServerEvent> = T extends unknown
  ? Omit<T, 'v' | 'seq' | 'timestamp'>
  : never

export interface RealtimePublishMeta {
  // 事件投递给项目级订阅者时使用；省略时总线按制品反查所属项目
  projectId?: string
}

export interface RealtimePublisher {
  publish(event: RealtimeEventPayload, meta?: RealtimePublishMeta): Promise<void>
}

export interface RealtimeSubscriptionOptions {
  // 订阅范围；两个范围字段都省略表示订阅全部
  artifactId?: PublicId
  projectId?: string
  // 已收到的最后序号；给出时先补发其后的事件，超出保留窗口则改发 `resync`
  lastSeq?: number
  // 同步回调；抛错不影响其他订阅者收到事件
  onEvent: (event: RealtimeServerEvent) => void
}

export interface RealtimeSubscriber {
  subscribe(options: RealtimeSubscriptionOptions): () => void
  getActiveConnections(): number
}

export interface Clock {
  /** ISO 8601 UTC 时间戳。 */
  now(): string
}

export interface IdGenerator {
  /** 须满足 `PublicIdSchema` 的格式。 */
  publicId(): PublicId
  /** `prefix` 标识用途（如 `proj`、`round`、`fb`、`rcpt`）。 */
  id(prefix: string): string
}
