import type {
  AnnotationThread,
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
import { PROTOCOL_VERSION } from '@akasha/protocol'
import { DomainError } from '../../../domain/errors.js'
import type {
  AnnotationRepository,
  ArtifactLifecycleRepository,
  ArtifactRelocation,
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  ProjectRepository,
  RealtimeEventPayload,
  RealtimePublisher,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** 以系统时间的 `toISOString()` 作为当前时间，产出 UTC 时间戳。 */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

/** 基于 Web Crypto 的标识生成器，Node 与 Cloudflare Workers 通用。 */
export class CryptoIdGenerator implements IdGenerator {
  private counter = 0

  /** 21 位字母数字。 */
  publicId(): PublicId {
    const bytes = new Uint8Array(21)
    globalThis.crypto.getRandomValues(bytes)
    let out = ''
    for (const b of bytes) {
      out += ALPHANUM[b % ALPHANUM.length]
    }
    return out
  }

  /** `<prefix>_<进程内序号>_<12 位十六进制随机数>`。 */
  id(prefix: string): string {
    this.counter += 1
    const bytes = new Uint8Array(6)
    globalThis.crypto.getRandomValues(bytes)
    const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${prefix}_${this.counter}_${rand}`
  }
}

// 本文件内的内存实现对外一律深拷贝：调用方修改传入或返回的对象，都不会影响已存数据。

export class InMemoryProjectRepository implements ProjectRepository {
  private readonly byId = new Map<string, Project>()

  async upsert(project: Project): Promise<Project> {
    const cloned = structuredClone(project)
    this.byId.set(cloned.id, cloned)
    return structuredClone(cloned)
  }

  async findById(id: string): Promise<Project | undefined> {
    const hit = this.byId.get(id)
    return hit ? structuredClone(hit) : undefined
  }

  async findByRootPath(rootPath: string): Promise<Project | undefined> {
    for (const p of this.byId.values()) {
      if (p.rootPath === rootPath) return structuredClone(p)
    }
    return undefined
  }

  async list(): Promise<readonly Project[]> {
    return Array.from(this.byId.values(), (p) => structuredClone(p))
  }

  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id)
  }
}

/** 另按「项目 + slug」维护唯一索引；同一制品版本号重复时追加失败。 */
export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<PublicId, Artifact>()
  private readonly slugIndex = new Map<string, PublicId>()
  private readonly versions = new Map<PublicId, Readonly<Version>[]>()
  private readonly withdrawals = new Map<PublicId, { at: string | null; generation: number }>()

  readonly lifecycle: ArtifactLifecycleRepository = {
    setWithdrawal: async (id, at) => {
      if (!this.artifacts.has(id)) return false
      const previous = this.withdrawals.get(id)
      if (at === null) {
        if (!previous?.at) return false
        this.withdrawals.set(id, { at: null, generation: previous.generation })
      } else {
        if (previous?.at) return false
        this.withdrawals.set(id, { at, generation: (previous?.generation ?? 0) + 1 })
      }
      return true
    },
    findWithdrawn: async (id) => {
      const artifact = this.artifacts.get(id)
      const withdrawnAt = this.withdrawals.get(id)?.at
      return artifact && withdrawnAt
        ? { artifact: structuredClone(artifact), withdrawnAt }
        : undefined
    },
    listWithdrawn: async () => {
      const items = []
      for (const [id, { at }] of this.withdrawals) {
        if (!at) continue
        const artifact = this.artifacts.get(id)
        if (artifact) items.push({ artifact: structuredClone(artifact), withdrawnAt: at })
      }
      items.sort((a, b) => b.withdrawnAt.localeCompare(a.withdrawnAt))
      return items
    },
    activeShareGeneration: async (id) => {
      const status = this.withdrawals.get(id)
      if (!this.artifacts.has(id) || status?.at) return
      return status?.generation ?? 0
    },
  }

  private slugKey(projectId: string, slug: Slug): string {
    return `${projectId}::${slug}`
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    const oldProject = this.artifacts.get(artifact.publicId)?.projectId
    this.storeArtifact(
      oldProject && oldProject !== artifact.projectId
        ? { ...artifact, projectId: oldProject }
        : artifact,
    )
  }

  private storeArtifact(artifact: Artifact): void {
    const key = this.slugKey(artifact.projectId, artifact.slug)
    const holder = this.slugIndex.get(key)
    if (holder && holder !== artifact.publicId)
      throw new DomainError('RESOURCE_CONFLICT', '目标项目已存在同名制品，原有内容未更改')
    const prev = this.artifacts.get(artifact.publicId)
    if (prev && (prev.projectId !== artifact.projectId || prev.slug !== artifact.slug)) {
      this.slugIndex.delete(this.slugKey(prev.projectId, prev.slug))
    }
    this.artifacts.set(artifact.publicId, structuredClone(artifact))
    this.slugIndex.set(key, artifact.publicId)
  }

  async renameTitle(id: PublicId, title: string, updatedAt: string): Promise<Artifact | undefined> {
    const artifact = this.artifacts.get(id)
    if (!artifact || this.withdrawals.get(id)?.at) return undefined
    const renamed = { ...artifact, title, updatedAt }
    this.artifacts.set(id, renamed)
    return structuredClone(renamed)
  }

  async relocate({ publicId, sourceProjectId, targetProjectId, updatedAt }: ArtifactRelocation) {
    const artifact = this.artifacts.get(publicId)
    if (!artifact || artifact.projectId !== sourceProjectId || this.withdrawals.get(publicId)?.at)
      return
    const moved = { ...artifact, projectId: targetProjectId, updatedAt }
    this.storeArtifact(moved)
    return moved
  }

  async findByPublicId(publicId: PublicId): Promise<Artifact | undefined> {
    const hit = this.artifacts.get(publicId)
    return hit && !this.withdrawals.get(publicId)?.at ? structuredClone(hit) : undefined
  }

  async findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined> {
    const publicId = this.slugIndex.get(this.slugKey(projectId, slug))
    return publicId ? this.findByPublicId(publicId) : undefined
  }

  async listByProject(projectId?: string): Promise<readonly Artifact[]> {
    const items: Artifact[] = []
    for (const a of this.artifacts.values()) {
      if ((!projectId || a.projectId === projectId) && !this.withdrawals.get(a.publicId)?.at) {
        items.push(structuredClone(a))
      }
    }
    return items
  }

  async appendVersion(version: Readonly<Version>): Promise<void> {
    const list = this.versions.get(version.artifactId) ?? []
    if (list.some((v) => v.version === version.version)) {
      throw new Error(`Artifact "${version.artifactId}" 已存在重复版本 v${version.version}`)
    }
    list.push(version)
    this.versions.set(version.artifactId, list)
  }

  async getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]> {
    return [...(this.versions.get(artifactId) ?? [])]
  }

  async getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined> {
    return this.versions.get(artifactId)?.find((v) => v.version === version)
  }
}

export class InMemoryStateRepository implements StateRepository {
  private readonly snapshots = new Map<PublicId, StateStreamSnapshot>()
  private readonly patches = new Map<PublicId, StatePatchEntry[]>()

  async getSnapshot(artifactId: PublicId): Promise<StateStreamSnapshot | undefined> {
    const hit = this.snapshots.get(artifactId)
    return hit ? structuredClone(hit) : undefined
  }

  async saveSnapshot(snapshot: StateStreamSnapshot): Promise<void> {
    this.snapshots.set(snapshot.artifactId, structuredClone(snapshot))
  }

  async appendPatch(artifactId: PublicId, entry: StatePatchEntry): Promise<void> {
    const list = this.patches.get(artifactId) ?? []
    list.push(structuredClone(entry))
    this.patches.set(artifactId, list)
  }

  async getPatches(artifactId: PublicId, afterSeq = 0): Promise<readonly StatePatchEntry[]> {
    const list = this.patches.get(artifactId) ?? []
    return list.filter((e) => e.seq > afterSeq).map((e) => structuredClone(e))
  }
}

export class InMemoryRoundRepository implements RoundRepository {
  private readonly rounds = new Map<PublicId, ReviewRound[]>()

  async saveRound(round: ReviewRound): Promise<void> {
    const list = this.rounds.get(round.artifactId) ?? []
    const idx = list.findIndex((r) => r.id === round.id)
    const cloned = structuredClone(round)
    if (idx === -1) list.push(cloned)
    else list[idx] = cloned
    this.rounds.set(round.artifactId, list)
  }

  async replaceRounds(artifactId: PublicId, rounds: readonly ReviewRound[]): Promise<void> {
    this.rounds.set(
      artifactId,
      rounds.map((r) => structuredClone(r)),
    )
  }

  async findById(artifactId: PublicId, roundId: string): Promise<ReviewRound | undefined> {
    const hit = this.rounds.get(artifactId)?.find((r) => r.id === roundId)
    return hit ? structuredClone(hit) : undefined
  }

  async listByArtifact(artifactId: PublicId): Promise<readonly ReviewRound[]> {
    return (this.rounds.get(artifactId) ?? []).map((r) => structuredClone(r))
  }
}

interface StoredFeedback {
  feedback: Feedback
  // 草稿与仅供讨论的记录没有游标；转正后的可投递草稿排在已下发游标之后。
  deliverySeq: number | null
}

/** 以可投递顺序号作为游标；转正的草稿排在已下发的反馈之后。 */
export class InMemoryFeedbackRepository implements FeedbackRepository {
  private nextDeliverySeq = 0
  private readonly orderedIds: string[] = []
  private readonly byId = new Map<string, StoredFeedback>()
  private readonly discussions = new Map<string, AnnotationThread>()

  readonly annotations: AnnotationRepository = {
    list: async (artifactId, includeDrafts) => {
      const result: Record<string, AnnotationThread> = Object.create(null)
      for (const [id, thread] of this.discussions) {
        const feedback = this.byId.get(id)?.feedback
        if (feedback?.artifactId === artifactId && (includeDrafts || !feedback.draft)) {
          result[id] = structuredClone(thread)
        }
      }
      return result
    },
    reply: async (id, reply) => {
      const thread = this.discussions.get(id) ?? { replies: [], resolution: null }
      thread.replies.push(structuredClone(reply))
      this.discussions.set(id, thread)
    },
    setResolution: async (id, resolution) => {
      const thread = this.discussions.get(id)
      if (!thread) {
        if (resolution) this.discussions.set(id, { replies: [], resolution: { ...resolution } })
      } else if (resolution) {
        thread.resolution ??= { ...resolution }
      } else if (thread.replies.length) {
        thread.resolution = null
      } else {
        this.discussions.delete(id)
      }
    },
  }

  async save(feedback: Feedback): Promise<void> {
    const existing = this.byId.get(feedback.id)
    let deliverySeq = existing?.deliverySeq ?? null
    if (!feedback.draft && feedback.audience !== 'human' && deliverySeq === null) {
      this.nextDeliverySeq += 1
      deliverySeq = this.nextDeliverySeq
    }
    if (!existing) {
      this.orderedIds.push(feedback.id)
    }
    this.byId.set(feedback.id, { feedback: structuredClone(feedback), deliverySeq })
  }

  async findById(id: string): Promise<Feedback | undefined> {
    const hit = this.byId.get(id)
    return hit ? structuredClone(hit.feedback) : undefined
  }

  async list(filter: {
    artifactId?: PublicId
    artifactIds?: ReadonlySet<PublicId>
    afterCursor?: string
    includeDrafts?: boolean
  }): Promise<{ items: readonly Feedback[]; cursor: string }> {
    const afterSeq = filter.afterCursor ? Number.parseInt(filter.afterCursor, 10) : 0
    const validAfter = Number.isFinite(afterSeq) && afterSeq > 0 ? afterSeq : 0

    const matched: StoredFeedback[] = []
    for (const id of this.orderedIds) {
      const entry = this.byId.get(id)
      if (!entry) continue
      const { feedback, deliverySeq } = entry
      if (filter.artifactId && feedback.artifactId !== filter.artifactId) continue
      if (filter.artifactIds && !filter.artifactIds.has(feedback.artifactId)) continue
      if (feedback.audience === 'human' || (feedback.audience === 'agent' && feedback.draft))
        continue
      if (!filter.includeDrafts) {
        if (feedback.draft || deliverySeq === null) continue
        if (deliverySeq <= validAfter) continue
      } else if (deliverySeq !== null && deliverySeq <= validAfter) {
        continue
      }
      matched.push(entry)
    }

    // 按投递顺序号升序排列（草稿附于末尾）
    matched.sort((a, b) => {
      if (a.deliverySeq === null && b.deliverySeq === null) return 0
      if (a.deliverySeq === null) return 1
      if (b.deliverySeq === null) return -1
      return a.deliverySeq - b.deliverySeq
    })

    let maxSeq = validAfter
    for (const entry of matched) {
      if (entry.deliverySeq !== null && entry.deliverySeq > maxSeq) {
        maxSeq = entry.deliverySeq
      }
    }

    return {
      items: matched.map((e) => structuredClone(e.feedback)),
      cursor: maxSeq > 0 ? String(maxSeq) : (filter.afterCursor ?? ''),
    }
  }

  async listForReview(artifactId: PublicId, includeDrafts: boolean): Promise<readonly Feedback[]> {
    const items: Feedback[] = []
    for (const id of this.orderedIds) {
      const feedback = this.byId.get(id)?.feedback
      if (feedback?.artifactId === artifactId && (includeDrafts || !feedback.draft)) {
        items.push(structuredClone(feedback))
      }
    }
    return items
  }

  async promoteRoundDrafts(
    artifactId: PublicId,
    roundId: string,
    updatedAt: string,
  ): Promise<number> {
    let count = 0
    for (const id of this.orderedIds) {
      const entry = this.byId.get(id)
      if (!entry) continue
      const { feedback } = entry
      if (feedback.artifactId === artifactId && feedback.roundId === roundId && feedback.draft) {
        const deliverySeq = feedback.audience === 'human' ? null : ++this.nextDeliverySeq
        this.byId.set(id, {
          feedback: { ...feedback, draft: false, updatedAt },
          deliverySeq,
        })
        count++
      }
    }
    return count
  }
}

export class InMemoryReceiptRepository implements ReceiptRepository {
  private readonly receipts = new Map<string, Receipt>()

  async save(receipt: Receipt): Promise<void> {
    this.receipts.set(receipt.receipt, structuredClone(receipt))
  }

  async consume(receiptId: string): Promise<Receipt | undefined> {
    const hit = this.receipts.get(receiptId)
    if (!hit) return undefined
    this.receipts.delete(receiptId)
    return structuredClone(hit)
  }
}

/** 只发布、不订阅的内存总线；事件按序保存在 `events` 里供断言。 */
export class InMemoryRealtimeBus implements RealtimePublisher {
  private seq = 0
  readonly events: RealtimeServerEvent[] = []

  constructor(private readonly clock: Clock) {}

  async publish(event: RealtimeEventPayload): Promise<void> {
    this.seq += 1
    this.events.push({
      ...event,
      v: PROTOCOL_VERSION,
      seq: this.seq,
      timestamp: this.clock.now(),
    } as RealtimeServerEvent)
  }
}
