import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  Artifact,
  Author,
  ElementRef,
  Feedback,
  FeedbackKind,
  FeedbackStatus,
  JsonPatchOp,
  Project,
  PublicId,
  Receipt,
  ReviewGroup,
  ReviewRound,
  ReviewRoundStatus,
  Slug,
  StatePatchEntry,
  StateStreamSnapshot,
  Version,
  Visibility,
} from '@akasha/protocol'
import { deepFreeze } from '../../../domain/freeze.js'
import type {
  ArtifactRepository,
  FeedbackRepository,
  ProjectRepository,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  root_path TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  public_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  head_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS versions (
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  author TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, version)
);

CREATE TABLE IF NOT EXISTS state_snapshots (
  artifact_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS state_patches (
  artifact_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ops_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (artifact_id, seq)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  status TEXT NOT NULL,
  groups_json TEXT NOT NULL,
  submitted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rounds_artifact ON rounds(artifact_id, ord ASC);

CREATE TABLE IF NOT EXISTS feedbacks (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  round_id TEXT,
  group_id TEXT,
  kind TEXT NOT NULL,
  element_json TEXT,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  draft INTEGER NOT NULL,
  status TEXT NOT NULL,
  delivery_seq INTEGER UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedbacks_artifact ON feedbacks(artifact_id, delivery_seq ASC);

CREATE TABLE IF NOT EXISTS receipts (
  receipt TEXT PRIMARY KEY,
  artifact_id TEXT,
  cursor TEXT NOT NULL,
  feedback_ids_json TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export class SqliteStorage {
  private closed = false
  readonly db: DatabaseSync
  readonly projects: SqliteProjectRepository
  readonly artifacts: SqliteArtifactRepository
  readonly states: SqliteStateRepository
  readonly rounds: SqliteRoundRepository
  readonly feedbacks: SqliteFeedbackRepository
  readonly receipts: SqliteReceiptRepository

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.db.exec(SCHEMA_SQL)

    this.projects = new SqliteProjectRepository(this.db)
    this.artifacts = new SqliteArtifactRepository(this.db)
    this.states = new SqliteStateRepository(this.db)
    this.rounds = new SqliteRoundRepository(this.db)
    this.feedbacks = new SqliteFeedbackRepository(this.db)
    this.receipts = new SqliteReceiptRepository(this.db)
  }

  getEventSeq(): number {
    if (this.closed) return 0
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'event_seq'").get() as
      | { value: string }
      | undefined
    return row ? Number.parseInt(row.value, 10) || 0 : 0
  }

  setEventSeq(seq: number): void {
    if (this.closed) return
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES ('event_seq', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(String(seq))
  }

  findProjectIdByArtifactSync(publicId: PublicId): string | undefined {
    if (this.closed) return undefined
    const row = this.db
      .prepare('SELECT project_id FROM artifacts WHERE public_id = ?')
      .get(publicId) as { project_id: string } | undefined
    return row?.project_id
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}

function runInTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: DatabaseSync) {}

  async upsert(project: Project): Promise<Project> {
    this.db
      .prepare(
        `INSERT INTO projects (id, root_path, name, last_active_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(root_path) DO UPDATE SET
           name = excluded.name,
           last_active_at = excluded.last_active_at`,
      )
      .run(project.id, project.rootPath, project.name, project.lastActiveAt)
    return (await this.findByRootPath(project.rootPath)) ?? structuredClone(project)
  }

  async findById(id: string): Promise<Project | undefined> {
    const row = this.db
      .prepare('SELECT id, root_path, name, last_active_at FROM projects WHERE id = ?')
      .get(id) as
      | { id: string; root_path: string; name: string; last_active_at: string }
      | undefined
    return row
      ? { id: row.id, rootPath: row.root_path, name: row.name, lastActiveAt: row.last_active_at }
      : undefined
  }

  async findByRootPath(rootPath: string): Promise<Project | undefined> {
    const row = this.db
      .prepare('SELECT id, root_path, name, last_active_at FROM projects WHERE root_path = ?')
      .get(rootPath) as
      | { id: string; root_path: string; name: string; last_active_at: string }
      | undefined
    return row
      ? { id: row.id, rootPath: row.root_path, name: row.name, lastActiveAt: row.last_active_at }
      : undefined
  }

  async list(): Promise<readonly Project[]> {
    const rows = this.db
      .prepare(
        'SELECT id, root_path, name, last_active_at FROM projects ORDER BY last_active_at DESC',
      )
      .all() as Array<{ id: string; root_path: string; name: string; last_active_at: string }>
    return rows.map((r) => ({
      id: r.id,
      rootPath: r.root_path,
      name: r.name,
      lastActiveAt: r.last_active_at,
    }))
  }

  async remove(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return Number(res.changes ?? 0) > 0
  }
}

interface ArtifactRow {
  public_id: string
  project_id: string
  slug: string
  title: string
  type: string
  visibility: string
  head_version: number
  created_at: string
  updated_at: string
}

function mapArtifact(row: ArtifactRow): Artifact {
  return {
    publicId: row.public_id,
    projectId: row.project_id,
    slug: row.slug,
    title: row.title,
    type: row.type as Artifact['type'],
    visibility: row.visibility as Visibility,
    headVersion: row.head_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface VersionRow {
  artifact_id: string
  version: number
  parent_version: number | null
  author: string
  title: string
  source: string
  created_at: string
}

function mapVersion(row: VersionRow): Readonly<Version> {
  return deepFreeze({
    artifactId: row.artifact_id,
    version: row.version,
    parentVersion: row.parent_version,
    author: row.author as Author,
    title: row.title,
    source: row.source,
    createdAt: row.created_at,
  })
}

export class SqliteArtifactRepository implements ArtifactRepository {
  constructor(private readonly db: DatabaseSync) {}

  private upsertArtifactSync(artifact: Artifact): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (public_id, project_id, slug, title, type, visibility, head_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(public_id) DO UPDATE SET
           project_id = excluded.project_id,
           slug = excluded.slug,
           title = excluded.title,
           type = excluded.type,
           visibility = excluded.visibility,
           head_version = excluded.head_version,
           updated_at = excluded.updated_at`,
      )
      .run(
        artifact.publicId,
        artifact.projectId,
        artifact.slug,
        artifact.title,
        artifact.type,
        artifact.visibility,
        artifact.headVersion,
        artifact.createdAt,
        artifact.updatedAt,
      )
  }

  private insertVersionSync(version: Readonly<Version>): void {
    this.db
      .prepare(
        `INSERT INTO versions (artifact_id, version, parent_version, author, title, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.artifactId,
        version.version,
        version.parentVersion,
        version.author,
        version.title,
        version.source,
        version.createdAt,
      )
  }

  // 在单个同步 SQLite 事务内原子写入版本与 Artifact 元数据，防止后续校验失败遗留孤儿版本。
  saveArtifactWithVersionSync(artifact: Artifact, version?: Readonly<Version>): void {
    runInTx(this.db, () => {
      if (version) {
        this.insertVersionSync(version)
      }
      this.upsertArtifactSync(artifact)
    })
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.upsertArtifactSync(artifact)
  }

  async findByPublicId(publicId: PublicId): Promise<Artifact | undefined> {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE public_id = ?').get(publicId) as
      | ArtifactRow
      | undefined
    return row ? mapArtifact(row) : undefined
  }

  async findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined> {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE project_id = ? AND slug = ?')
      .get(projectId, slug) as ArtifactRow | undefined
    return row ? mapArtifact(row) : undefined
  }

  async listByProject(projectId?: string): Promise<readonly Artifact[]> {
    const rows = projectId
      ? (this.db
          .prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC')
          .all(projectId) as unknown as ArtifactRow[])
      : (this.db
          .prepare('SELECT * FROM artifacts ORDER BY updated_at DESC')
          .all() as unknown as ArtifactRow[])
    return rows.map(mapArtifact)
  }

  async appendVersion(version: Readonly<Version>): Promise<void> {
    this.insertVersionSync(version)
  }

  async getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]> {
    const rows = this.db
      .prepare('SELECT * FROM versions WHERE artifact_id = ? ORDER BY version ASC')
      .all(artifactId) as unknown as VersionRow[]
    return rows.map(mapVersion)
  }

  async getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined> {
    const row = this.db
      .prepare('SELECT * FROM versions WHERE artifact_id = ? AND version = ?')
      .get(artifactId, version) as VersionRow | undefined
    return row ? mapVersion(row) : undefined
  }
}

export class SqliteStateRepository implements StateRepository {
  constructor(private readonly db: DatabaseSync) {}

  async getSnapshot(artifactId: PublicId): Promise<StateStreamSnapshot | undefined> {
    const row = this.db
      .prepare(
        'SELECT artifact_id, seq, snapshot_json, updated_at FROM state_snapshots WHERE artifact_id = ?',
      )
      .get(artifactId) as
      | { artifact_id: string; seq: number; snapshot_json: string; updated_at: string }
      | undefined
    if (!row) return undefined
    return {
      artifactId: row.artifact_id,
      seq: row.seq,
      snapshot: JSON.parse(row.snapshot_json) as Record<string, unknown>,
      updatedAt: row.updated_at,
    }
  }

  async saveSnapshot(snapshot: StateStreamSnapshot): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO state_snapshots (artifact_id, seq, snapshot_json, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(artifact_id) DO UPDATE SET
           seq = excluded.seq,
           snapshot_json = excluded.snapshot_json,
           updated_at = excluded.updated_at`,
      )
      .run(snapshot.artifactId, snapshot.seq, JSON.stringify(snapshot.snapshot), snapshot.updatedAt)
  }

  async appendPatch(artifactId: PublicId, entry: StatePatchEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO state_patches (artifact_id, seq, ops_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(artifactId, entry.seq, JSON.stringify(entry.ops), entry.createdAt)
  }

  async getPatches(artifactId: PublicId, afterSeq = 0): Promise<readonly StatePatchEntry[]> {
    const rows = this.db
      .prepare(
        'SELECT seq, ops_json, created_at FROM state_patches WHERE artifact_id = ? AND seq > ? ORDER BY seq ASC',
      )
      .all(artifactId, afterSeq) as Array<{ seq: number; ops_json: string; created_at: string }>
    return rows.map((r) => ({
      seq: r.seq,
      ops: JSON.parse(r.ops_json) as JsonPatchOp[],
      createdAt: r.created_at,
    }))
  }
}

interface RoundRow {
  id: string
  artifact_id: string
  ord: number
  status: string
  groups_json: string
  submitted_at: string | null
  created_at: string
}

function mapRound(row: RoundRow): ReviewRound {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    status: row.status as ReviewRoundStatus,
    groups: JSON.parse(row.groups_json) as ReviewGroup[],
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
  }
}

export class SqliteRoundRepository implements RoundRepository {
  constructor(private readonly db: DatabaseSync) {}

  async saveRound(round: ReviewRound): Promise<void> {
    runInTx(this.db, () => {
      const existing = this.db.prepare('SELECT ord FROM rounds WHERE id = ?').get(round.id) as
        | { ord: number }
        | undefined
      const ord =
        existing?.ord ??
        (
          this.db
            .prepare(
              'SELECT COALESCE(MAX(ord), 0) + 1 AS next_ord FROM rounds WHERE artifact_id = ?',
            )
            .get(round.artifactId) as { next_ord: number }
        ).next_ord

      this.db
        .prepare(
          `INSERT INTO rounds (id, artifact_id, ord, status, groups_json, submitted_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             groups_json = excluded.groups_json,
             submitted_at = excluded.submitted_at`,
        )
        .run(
          round.id,
          round.artifactId,
          ord,
          round.status,
          JSON.stringify(round.groups),
          round.submittedAt,
          round.createdAt,
        )
    })
  }

  async replaceRounds(artifactId: PublicId, rounds: readonly ReviewRound[]): Promise<void> {
    runInTx(this.db, () => {
      this.db.prepare('DELETE FROM rounds WHERE artifact_id = ?').run(artifactId)
      const stmt = this.db.prepare(
        `INSERT INTO rounds (id, artifact_id, ord, status, groups_json, submitted_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      rounds.forEach((r, idx) => {
        stmt.run(
          r.id,
          r.artifactId,
          idx + 1,
          r.status,
          JSON.stringify(r.groups),
          r.submittedAt,
          r.createdAt,
        )
      })
    })
  }

  async findById(artifactId: PublicId, roundId: string): Promise<ReviewRound | undefined> {
    const row = this.db
      .prepare('SELECT * FROM rounds WHERE artifact_id = ? AND id = ?')
      .get(artifactId, roundId) as RoundRow | undefined
    return row ? mapRound(row) : undefined
  }

  async listByArtifact(artifactId: PublicId): Promise<readonly ReviewRound[]> {
    const rows = this.db
      .prepare('SELECT * FROM rounds WHERE artifact_id = ? ORDER BY ord ASC')
      .all(artifactId) as unknown as RoundRow[]
    return rows.map(mapRound)
  }
}

interface FeedbackRow {
  id: string
  artifact_id: string
  version: number
  round_id: string | null
  group_id: string | null
  kind: string
  element_json: string | null
  body: string
  author: string
  draft: number
  status: string
  delivery_seq: number | null
  created_at: string
  updated_at: string
}

function mapFeedback(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    version: row.version,
    roundId: row.round_id,
    groupId: row.group_id,
    kind: row.kind as FeedbackKind,
    element: row.element_json ? (JSON.parse(row.element_json) as ElementRef) : null,
    body: row.body,
    author: row.author as Author,
    draft: row.draft === 1,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SqliteFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(feedback: Feedback): Promise<void> {
    runInTx(this.db, () => {
      const existing = this.db
        .prepare('SELECT delivery_seq FROM feedbacks WHERE id = ?')
        .get(feedback.id) as { delivery_seq: number | null } | undefined

      let deliverySeq = existing?.delivery_seq ?? null
      if (!feedback.draft && deliverySeq === null) {
        const next = this.db
          .prepare('SELECT COALESCE(MAX(delivery_seq), 0) + 1 AS next_seq FROM feedbacks')
          .get() as { next_seq: number }
        deliverySeq = next.next_seq
      }

      this.db
        .prepare(
          `INSERT INTO feedbacks
             (id, artifact_id, version, round_id, group_id, kind, element_json, body, author, draft, status, delivery_seq, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             draft = excluded.draft,
             status = excluded.status,
             delivery_seq = COALESCE(feedbacks.delivery_seq, excluded.delivery_seq),
             updated_at = excluded.updated_at`,
        )
        .run(
          feedback.id,
          feedback.artifactId,
          feedback.version,
          feedback.roundId,
          feedback.groupId,
          feedback.kind,
          feedback.element ? JSON.stringify(feedback.element) : null,
          feedback.body,
          feedback.author,
          feedback.draft ? 1 : 0,
          feedback.status,
          deliverySeq,
          feedback.createdAt,
          feedback.updatedAt,
        )
    })
  }

  async findById(id: string): Promise<Feedback | undefined> {
    const row = this.db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(id) as
      | FeedbackRow
      | undefined
    return row ? mapFeedback(row) : undefined
  }

  async list(filter: {
    artifactId?: PublicId
    artifactIds?: ReadonlySet<PublicId>
    afterCursor?: string
    includeDrafts?: boolean
  }): Promise<{ items: readonly Feedback[]; cursor: string }> {
    const parsedAfter = filter.afterCursor ? Number.parseInt(filter.afterCursor, 10) : 0
    const afterSeq = Number.isFinite(parsedAfter) && parsedAfter > 0 ? parsedAfter : 0

    const conditions: string[] = []
    const params: Array<string | number> = []

    if (filter.artifactId) {
      conditions.push('artifact_id = ?')
      params.push(filter.artifactId)
    }
    if (filter.artifactIds) {
      if (filter.artifactIds.size === 0) {
        return { items: [], cursor: filter.afterCursor ?? '' }
      }
      const ids = Array.from(filter.artifactIds)
      conditions.push(`artifact_id IN (${ids.map(() => '?').join(', ')})`)
      params.push(...ids)
    }
    if (!filter.includeDrafts) {
      conditions.push('draft = 0 AND delivery_seq IS NOT NULL AND delivery_seq > ?')
      params.push(afterSeq)
    } else {
      conditions.push('(delivery_seq IS NULL OR delivery_seq > ?)')
      params.push(afterSeq)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const sql = `SELECT * FROM feedbacks ${where} ORDER BY CASE WHEN delivery_seq IS NULL THEN 1 ELSE 0 END ASC, delivery_seq ASC, rowid ASC`
    const rows = this.db.prepare(sql).all(...params) as unknown as FeedbackRow[]

    let maxSeq = afterSeq
    for (const r of rows) {
      if (r.delivery_seq !== null && r.delivery_seq > maxSeq) {
        maxSeq = r.delivery_seq
      }
    }
    return {
      items: rows.map(mapFeedback),
      cursor: maxSeq > 0 ? String(maxSeq) : (filter.afterCursor ?? ''),
    }
  }

  async promoteRoundDrafts(
    artifactId: PublicId,
    roundId: string,
    updatedAt: string,
  ): Promise<number> {
    return runInTx(this.db, () => {
      const drafts = this.db
        .prepare(
          'SELECT id FROM feedbacks WHERE artifact_id = ? AND round_id = ? AND draft = 1 ORDER BY rowid ASC',
        )
        .all(artifactId, roundId) as Array<{ id: string }>

      if (drafts.length === 0) return 0

      let seq = (
        this.db
          .prepare('SELECT COALESCE(MAX(delivery_seq), 0) AS max_seq FROM feedbacks')
          .get() as { max_seq: number }
      ).max_seq

      const stmt = this.db.prepare(
        'UPDATE feedbacks SET draft = 0, delivery_seq = ?, updated_at = ? WHERE id = ?',
      )
      for (const d of drafts) {
        seq += 1
        stmt.run(seq, updatedAt, d.id)
      }
      return drafts.length
    })
  }
}

export class SqliteReceiptRepository implements ReceiptRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(receipt: Receipt): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO receipts (receipt, artifact_id, cursor, feedback_ids_json, issued_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.receipt,
        receipt.artifactId,
        receipt.cursor,
        JSON.stringify(receipt.feedbackIds),
        receipt.issuedAt,
      )
  }

  async consume(receiptId: string): Promise<Receipt | undefined> {
    return runInTx(this.db, () => {
      const row = this.db.prepare('SELECT * FROM receipts WHERE receipt = ?').get(receiptId) as
        | {
            receipt: string
            artifact_id: string | null
            cursor: string
            feedback_ids_json: string
            issued_at: string
          }
        | undefined
      if (!row) return undefined
      this.db.prepare('DELETE FROM receipts WHERE receipt = ?').run(receiptId)
      return {
        receipt: row.receipt,
        artifactId: row.artifact_id,
        cursor: row.cursor,
        feedbackIds: JSON.parse(row.feedback_ids_json) as string[],
        issuedAt: row.issued_at,
      }
    })
  }
}
