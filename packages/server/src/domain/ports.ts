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

export interface ProjectRepository {
  upsert(project: Project): Promise<Project>
  findById(id: string): Promise<Project | undefined>
  findByRootPath(rootPath: string): Promise<Project | undefined>
  list(): Promise<readonly Project[]>
}

export interface ArtifactRepository {
  saveArtifact(artifact: Artifact): Promise<void>
  findByPublicId(publicId: PublicId): Promise<Artifact | undefined>
  findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined>
  listByProject(projectId?: string): Promise<readonly Artifact[]>
  appendVersion(version: Readonly<Version>): Promise<void>
  getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]>
  getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined>
}

export interface StateRepository {
  getSnapshot(artifactId: PublicId): Promise<StateStreamSnapshot | undefined>
  saveSnapshot(snapshot: StateStreamSnapshot): Promise<void>
  appendPatch(artifactId: PublicId, entry: StatePatchEntry): Promise<void>
  getPatches(artifactId: PublicId, afterSeq?: number): Promise<readonly StatePatchEntry[]>
}

export interface RoundRepository {
  saveRound(round: ReviewRound): Promise<void>
  replaceRounds(artifactId: PublicId, rounds: readonly ReviewRound[]): Promise<void>
  findById(artifactId: PublicId, roundId: string): Promise<ReviewRound | undefined>
  listByArtifact(artifactId: PublicId): Promise<readonly ReviewRound[]>
}

export interface FeedbackRepository {
  save(feedback: Feedback): Promise<void>
  findById(id: string): Promise<Feedback | undefined>
  list(filter: {
    artifactId?: PublicId
    artifactIds?: ReadonlySet<PublicId>
    afterCursor?: string
    includeDrafts?: boolean
  }): Promise<{ items: readonly Feedback[]; cursor: string }>
  promoteRoundDrafts(artifactId: PublicId, roundId: string, updatedAt: string): Promise<number>
}

export interface ReceiptRepository {
  save(receipt: Receipt): Promise<void>
  consume(receiptId: string): Promise<Receipt | undefined>
}

export type RealtimeEventPayload<T = RealtimeServerEvent> = T extends unknown
  ? Omit<T, 'v' | 'seq' | 'timestamp'>
  : never

export interface RealtimePublisher {
  publish(event: RealtimeEventPayload): Promise<void>
}

export interface RealtimeSubscriptionOptions {
  artifactId?: PublicId
  projectId?: string
  lastSeq?: number
  onEvent: (event: RealtimeServerEvent) => void
}

export interface RealtimeSubscriber {
  subscribe(options: RealtimeSubscriptionOptions): () => void
  getActiveConnections(): number
}

export interface Clock {
  now(): string
}

export interface IdGenerator {
  publicId(): PublicId
  id(prefix: string): string
}
