import type {
  Artifact,
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

/** 制品与其不可变版本历史的仓储端口。 */
export interface ArtifactRepository {
  /** 按 `publicId` 插入或整体覆盖；项目或 slug 变更时须同步维护 slug 唯一索引。 */
  saveArtifact(artifact: Artifact): Promise<void>
  findByPublicId(publicId: PublicId): Promise<Artifact | undefined>
  findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined>
  /** `projectId` 省略时跨项目列出全部。 */
  listByProject(projectId?: string): Promise<readonly Artifact[]>
  /** 追加一个版本；同一制品出现重复版本号视为数据损坏并抛错。 */
  appendVersion(version: Readonly<Version>): Promise<void>
  getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]>
  getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined>
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

/** 反馈队列的仓储端口；游标即「可投递顺序号」。 */
export interface FeedbackRepository {
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
    includeDrafts?: boolean
  }): Promise<{ items: readonly Feedback[]; cursor: string }>
  /** 把某轮次下的草稿转为可投递并分配顺序号；返回转正的条数。 */
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
