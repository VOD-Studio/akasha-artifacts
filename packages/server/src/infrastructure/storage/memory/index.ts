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
import { PROTOCOL_VERSION } from '@akasha/protocol'
import type {
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

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}

// 使用 Web 标准 crypto.getRandomValues，兼容 Node 与 Cloudflare Workers
export class CryptoIdGenerator implements IdGenerator {
  private counter = 0

  publicId(): PublicId {
    const bytes = new Uint8Array(21)
    globalThis.crypto.getRandomValues(bytes)
    let out = ''
    for (const b of bytes) {
      out += ALPHANUM[b % ALPHANUM.length]
    }
    return out
  }

  id(prefix: string): string {
    this.counter += 1
    const bytes = new Uint8Array(6)
    globalThis.crypto.getRandomValues(bytes)
    const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${prefix}_${this.counter}_${rand}`
  }
}

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
}

export class InMemoryArtifactRepository implements ArtifactRepository {
  private readonly artifacts = new Map<PublicId, Artifact>()
  private readonly slugIndex = new Map<string, PublicId>()
  private readonly versions = new Map<PublicId, Readonly<Version>[]>()

  private slugKey(projectId: string, slug: Slug): string {
    return `${projectId}::${slug}`
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    const prev = this.artifacts.get(artifact.publicId)
    if (prev && (prev.projectId !== artifact.projectId || prev.slug !== artifact.slug)) {
      this.slugIndex.delete(this.slugKey(prev.projectId, prev.slug))
    }
    this.artifacts.set(artifact.publicId, structuredClone(artifact))
    this.slugIndex.set(this.slugKey(artifact.projectId, artifact.slug), artifact.publicId)
  }

  async findByPublicId(publicId: PublicId): Promise<Artifact | undefined> {
    const hit = this.artifacts.get(publicId)
    return hit ? structuredClone(hit) : undefined
  }

  async findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined> {
    const publicId = this.slugIndex.get(this.slugKey(projectId, slug))
    return publicId ? this.findByPublicId(publicId) : undefined
  }

  async listByProject(projectId?: string): Promise<readonly Artifact[]> {
    const items: Artifact[] = []
    for (const a of this.artifacts.values()) {
      if (!projectId || a.projectId === projectId) {
        items.push(structuredClone(a))
      }
    }
    return items
  }

  async appendVersion(version: Readonly<Version>): Promise<void> {
    const list = this.versions.get(version.artifactId) ?? []
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

export class InMemoryFeedbackRepository implements FeedbackRepository {
  private readonly orderedIds: string[] = []
  private readonly byId = new Map<string, Feedback>()

  async save(feedback: Feedback): Promise<void> {
    if (!this.byId.has(feedback.id)) {
      this.orderedIds.push(feedback.id)
    }
    this.byId.set(feedback.id, structuredClone(feedback))
  }

  async findById(id: string): Promise<Feedback | undefined> {
    const hit = this.byId.get(id)
    return hit ? structuredClone(hit) : undefined
  }

  async list(filter: {
    artifactId?: PublicId
    afterId?: string
    includeDrafts?: boolean
  }): Promise<readonly Feedback[]> {
    let startIdx = 0
    if (filter.afterId) {
      const idx = this.orderedIds.indexOf(filter.afterId)
      if (idx !== -1) startIdx = idx + 1
    }
    const result: Feedback[] = []
    for (let i = startIdx; i < this.orderedIds.length; i++) {
      const id = this.orderedIds[i]
      if (!id) continue
      const fb = this.byId.get(id)
      if (!fb) continue
      if (filter.artifactId && fb.artifactId !== filter.artifactId) continue
      if (!filter.includeDrafts && fb.draft) continue
      result.push(structuredClone(fb))
    }
    return result
  }

  async promoteRoundDrafts(
    artifactId: PublicId,
    roundId: string,
    updatedAt: string,
  ): Promise<number> {
    let count = 0
    for (const [id, fb] of this.byId.entries()) {
      if (fb.artifactId === artifactId && fb.roundId === roundId && fb.draft) {
        this.byId.set(id, { ...fb, draft: false, updatedAt })
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
