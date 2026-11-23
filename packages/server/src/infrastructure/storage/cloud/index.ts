import type {
  Artifact,
  Feedback,
  Project,
  Receipt,
  ReviewRound,
  StatePatchEntry,
  StateStreamSnapshot,
  Version,
} from '@akasha/protocol'
import type { ArtifactStorageRepository } from '../../../domain/artifact-storage.js'
import { deepFreeze } from '../../../domain/freeze.js'
import type {
  ArtifactRepository,
  FeedbackRepository,
  ProjectRepository,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'
import { schema } from './schema.js'
import type { SqlDriver, SqlStatement, SqlValue, SqlWriteLock, VersionBlobs } from './types.js'

const projectColumns = 'id, root_path AS "rootPath", name, last_active_at AS "lastActiveAt"'
const artifactColumns =
  'public_id AS "publicId", project_id AS "projectId", slug, title, type, visibility, head_version AS "headVersion", created_at AS "createdAt", updated_at AS "updatedAt"'
const versionColumns =
  'artifact_id AS "artifactId", version, parent_version AS "parentVersion", author, title, source_json, blob_key, created_at AS "createdAt"'
const roundColumns =
  'id, artifact_id AS "artifactId", status, groups_json, submitted_at AS "submittedAt", created_at AS "createdAt"'
const feedbackColumns =
  'id, artifact_id AS "artifactId", version, round_id AS "roundId", group_id AS "groupId", kind, element_json, body, author, draft, status, created_at AS "createdAt", updated_at AS "updatedAt"'
const receiptColumns =
  'receipt, artifact_id AS "artifactId", cursor, feedback_ids_json, issued_at AS "issuedAt"'

type VersionRow = Omit<Version, 'source'> & { source_json: string | null; blob_key: string | null }
type SnapshotRow = Omit<StateStreamSnapshot, 'snapshot'> & { snapshot_json: string }
type PatchRow = Omit<StatePatchEntry, 'ops'> & { ops_json: string }
type RoundRow = Omit<ReviewRound, 'groups'> & { groups_json: string }
type FeedbackRow = Omit<Feedback, 'draft' | 'element'> & {
  draft: number
  element_json: string | null
}
type ReceiptRow = Omit<Receipt, 'feedbackIds'> & { feedback_ids_json: string }

const mapRound = ({ groups_json, ...round }: RoundRow): ReviewRound => ({
  ...round,
  groups: JSON.parse(groups_json) as ReviewRound['groups'],
})
const mapFeedback = ({ draft, element_json, ...feedback }: FeedbackRow): Feedback => ({
  ...feedback,
  draft: draft === 1,
  element: element_json === null ? null : (JSON.parse(element_json) as Feedback['element']),
})
const insertRound = `INSERT INTO rounds (id, artifact_id, ord, status, groups_json, submitted_at, created_at)`
// SQLite BIGINT 的上限；更大的游标一律按它处理，避免 CAST 溢出
const maxSqlCursor = '9223372036854775807'

async function versionBlobKey(version: Readonly<Version>): Promise<string> {
  // 对象地址包含内容摘要，竞争写入不会覆写已提交版本的源码。
  const bytes = new TextEncoder().encode(version.source)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let hex = ''
  for (const byte of hash) hex += byte.toString(16).padStart(2, '0')
  return `versions/${encodeURIComponent(version.artifactId)}/${version.version}/${hex}`
}

/**
 * 基于 SQL 驱动组装全部仓储，是 Hub 的 SQLite 与 PostgreSQL 两种部署共用的实现。
 *
 * @remarks 建表在首次查询前完成，`ready` 可供调用方等待。传入 `blobs` 后版本源码写入对象存储，
 * 表里只保留对象键。返回的版本对象一律递归冻结。
 */
export function createCloudStorage(driver: SqlDriver, blobs?: VersionBlobs) {
  const ready = driver.batch(schema, 'schema').then(() => {})
  async function query<Row>(sql: string, ...params: SqlValue[]): Promise<Row[]> {
    await ready
    return driver.execute<Row>([sql, ...params])
  }
  async function first<Row>(sql: string, ...params: SqlValue[]): Promise<Row | undefined> {
    return (await query<Row>(sql, ...params))[0]
  }
  async function write<Row>(lock: SqlWriteLock, ...statements: SqlStatement[]): Promise<Row[]> {
    await ready
    return driver.batch<Row>(statements, lock)
  }

  const projects: ProjectRepository = {
    async upsert(project) {
      const row = await first<Project>(
        `INSERT INTO projects (id, root_path, name, last_active_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(root_path) DO UPDATE SET name = excluded.name, last_active_at = excluded.last_active_at
         RETURNING ${projectColumns}`,
        project.id,
        project.rootPath,
        project.name,
        project.lastActiveAt,
      )
      if (!row) throw new Error('写入项目后未返回记录')
      return row
    },
    findById: (id) => first<Project>(`SELECT ${projectColumns} FROM projects WHERE id = ?`, id),
    findByRootPath: (rootPath) =>
      first<Project>(`SELECT ${projectColumns} FROM projects WHERE root_path = ?`, rootPath),
    list: () =>
      query<Project>(`SELECT ${projectColumns} FROM projects ORDER BY last_active_at DESC`),
    async remove(id) {
      return (await query('DELETE FROM projects WHERE id = ? RETURNING id', id)).length > 0
    },
  }

  async function mapVersion({ source_json, blob_key, ...version }: VersionRow) {
    if (blob_key === null) {
      if (source_json === null) throw new Error('版本缺少源码')
      return deepFreeze({ ...version, source: JSON.parse(source_json) as string })
    }
    if (!blobs) throw new Error('读取该版本需要配置对象存储')
    const source = await blobs.get(blob_key)
    if (source === null) throw new Error(`对象存储中缺少版本源码：${blob_key}`)
    return deepFreeze({ ...version, source })
  }

  const artifacts: ArtifactRepository = {
    async saveArtifact(artifact) {
      await query(
        `INSERT INTO artifacts (public_id, project_id, slug, title, type, visibility, head_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(public_id) DO UPDATE SET project_id = excluded.project_id,
           slug = excluded.slug, title = excluded.title, type = excluded.type,
           visibility = excluded.visibility, head_version = excluded.head_version, updated_at = excluded.updated_at`,
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
    },
    findByPublicId: (id) =>
      first<Artifact>(`SELECT ${artifactColumns} FROM artifacts WHERE public_id = ?`, id),
    findBySlug: (projectId, slug) =>
      first<Artifact>(
        `SELECT ${artifactColumns} FROM artifacts WHERE project_id = ? AND slug = ?`,
        projectId,
        slug,
      ),
    listByProject: (projectId) =>
      projectId === undefined
        ? query<Artifact>(`SELECT ${artifactColumns} FROM artifacts ORDER BY updated_at DESC`)
        : query<Artifact>(
            `SELECT ${artifactColumns} FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC`,
            projectId,
          ),
    // 先写对象再写表行，表行指向的对象一定已经存在
    async appendVersion(version) {
      await ready
      let key: string | null = null
      if (blobs) {
        key = await versionBlobKey(version)
        await blobs.put(key, version.source)
      }
      await query(
        `INSERT INTO versions (artifact_id, version, parent_version, author, title, source_json, blob_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        version.artifactId,
        version.version,
        version.parentVersion,
        version.author,
        version.title,
        blobs ? null : JSON.stringify(version.source),
        key,
        version.createdAt,
      )
    },
    async getVersions(artifactId) {
      const rows = await query<VersionRow>(
        `SELECT ${versionColumns} FROM versions WHERE artifact_id = ? ORDER BY version ASC`,
        artifactId,
      )
      // 不为整段历史同时发起对象读取，避免单次请求占满对象存储连接。
      const versions: Readonly<Version>[] = []
      for (const row of rows) versions.push(await mapVersion(row))
      return versions
    },
    async getVersion(artifactId, version) {
      const row = await first<VersionRow>(
        `SELECT ${versionColumns} FROM versions WHERE artifact_id = ? AND version = ?`,
        artifactId,
        version,
      )
      return row && mapVersion(row)
    },
  }

  const states: StateRepository = {
    async getSnapshot(artifactId) {
      const row = await first<SnapshotRow>(
        `SELECT artifact_id AS "artifactId", seq, snapshot_json, updated_at AS "updatedAt"
         FROM state_snapshots WHERE artifact_id = ?`,
        artifactId,
      )
      if (!row) return undefined
      const { snapshot_json, ...snapshot } = row
      return {
        ...snapshot,
        snapshot: JSON.parse(snapshot_json) as StateStreamSnapshot['snapshot'],
      }
    },
    async saveSnapshot(snapshot) {
      await query(
        `INSERT INTO state_snapshots (artifact_id, seq, snapshot_json, updated_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(artifact_id) DO UPDATE SET seq = excluded.seq,
           snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
        snapshot.artifactId,
        snapshot.seq,
        JSON.stringify(snapshot.snapshot),
        snapshot.updatedAt,
      )
    },
    async appendPatch(artifactId, entry) {
      await query(
        'INSERT INTO state_patches (artifact_id, seq, ops_json, created_at) VALUES (?, ?, ?, ?)',
        artifactId,
        entry.seq,
        JSON.stringify(entry.ops),
        entry.createdAt,
      )
    },
    async getPatches(artifactId, afterSeq = 0) {
      const rows = await query<PatchRow>(
        `SELECT seq, ops_json, created_at AS "createdAt" FROM state_patches
         WHERE artifact_id = ? AND seq > ? ORDER BY seq`,
        artifactId,
        afterSeq,
      )
      return rows.map(({ ops_json, ...entry }) => ({
        ...entry,
        ops: JSON.parse(ops_json) as StatePatchEntry['ops'],
      }))
    },
  }

  const rounds: RoundRepository = {
    // 新轮次的 ord 取制品内最大值加一；已有轮次只更新状态、分组与提交时间
    async saveRound(round) {
      await write('rounds', [
        `${insertRound} VALUES (?, ?, (SELECT COALESCE(MAX(ord), 0) + 1 FROM rounds WHERE artifact_id = ?), ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status,
           groups_json = excluded.groups_json, submitted_at = excluded.submitted_at`,
        round.id,
        round.artifactId,
        round.artifactId,
        round.status,
        JSON.stringify(round.groups),
        round.submittedAt,
        round.createdAt,
      ])
    },
    // 删除后按数组下标重排 ord，整个替换在同一事务内完成
    async replaceRounds(artifactId, replacement) {
      const statements: SqlStatement[] = [['DELETE FROM rounds WHERE artifact_id = ?', artifactId]]
      for (let index = 0; index < replacement.length; index += 1) {
        const round = replacement[index]
        statements.push([
          `${insertRound} VALUES (?, ?, ?, ?, ?, ?, ?)`,
          round.id,
          round.artifactId,
          index + 1,
          round.status,
          JSON.stringify(round.groups),
          round.submittedAt,
          round.createdAt,
        ])
      }
      await ready
      await driver.batch(statements, 'rounds')
    },
    async findById(artifactId, roundId) {
      const row = await first<RoundRow>(
        `SELECT ${roundColumns} FROM rounds WHERE artifact_id = ? AND id = ?`,
        artifactId,
        roundId,
      )
      return row && mapRound(row)
    },
    async listByArtifact(artifactId) {
      const rows = await query<RoundRow>(
        `SELECT ${roundColumns} FROM rounds WHERE artifact_id = ? ORDER BY ord`,
        artifactId,
      )
      return rows.map(mapRound)
    },
  }

  const feedbacks: FeedbackRepository = {
    async save(feedback) {
      // 投递序号与记录在同一事务提交，避免靠序列取号导致提交乱序、跳过反馈。
      const draft = feedback.draft ? 1 : 0
      await write('feedbacks', [
        `INSERT INTO feedbacks (id, artifact_id, version, round_id, group_id, kind, element_json, body, author,
           draft, status, insertion_seq, delivery_seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(insertion_seq), 0) + 1 FROM feedbacks),
           CASE WHEN ? = 1 THEN NULL ELSE (SELECT COALESCE(MAX(delivery_seq), 0) + 1 FROM feedbacks) END, ?, ?)
         ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, status = excluded.status,
           delivery_seq = COALESCE(feedbacks.delivery_seq, excluded.delivery_seq), updated_at = excluded.updated_at`,
        feedback.id,
        feedback.artifactId,
        feedback.version,
        feedback.roundId,
        feedback.groupId,
        feedback.kind,
        feedback.element === null ? null : JSON.stringify(feedback.element),
        feedback.body,
        feedback.author,
        draft,
        feedback.status,
        draft,
        feedback.createdAt,
        feedback.updatedAt,
      ])
    },
    async findById(id) {
      const row = await first<FeedbackRow>(
        `SELECT ${feedbackColumns} FROM feedbacks WHERE id = ?`,
        id,
      )
      return row && mapFeedback(row)
    },
    async list(filter) {
      // 范围是空集时直接返回，不依赖各数据库对 IN () 的处理
      if (filter.artifactIds?.size === 0) return { items: [], cursor: filter.afterCursor ?? '' }
      const seq = filter.afterCursor?.match(/^\s*\+?0*([1-9]\d*)/)?.[1] ?? ''
      const boundedSeq =
        seq.length > maxSqlCursor.length ||
        (seq.length === maxSqlCursor.length && seq > maxSqlCursor)
          ? maxSqlCursor
          : seq || '0'
      const where = [
        filter.includeDrafts
          ? '(delivery_seq IS NULL OR delivery_seq > CAST(? AS BIGINT))'
          : 'draft = 0 AND delivery_seq > CAST(? AS BIGINT)',
      ]
      const params: SqlValue[] = [boundedSeq]
      if (filter.artifactId) {
        where.push('artifact_id = ?')
        params.push(filter.artifactId)
      }
      if (filter.artifactIds) {
        // 用单个 JSON 参数传入可见范围，不随制品数增加绑定参数。
        where.push(`artifact_id IN (SELECT value FROM ${driver.jsonArrayValues})`)
        params.push(JSON.stringify([...filter.artifactIds]))
      }
      const rows = await query<FeedbackRow & { cursor: string | null }>(
        `SELECT ${feedbackColumns}, CAST(delivery_seq AS TEXT) AS cursor FROM feedbacks WHERE ${where.join(' AND ')}
         ORDER BY CASE WHEN delivery_seq IS NULL THEN 1 ELSE 0 END, delivery_seq, insertion_seq`,
        ...params,
      )
      // 游标取最后一条可投递反馈的序号；结果里只有草稿时沿用入参
      let cursor = seq || filter.afterCursor || ''
      const items = rows.map(({ cursor: delivered, ...row }) => {
        if (delivered !== null) cursor = delivered
        return mapFeedback(row)
      })
      return { items, cursor }
    },
    // 转正的草稿按插入顺序接在当前最大投递序号之后
    async promoteRoundDrafts(artifactId, roundId, updatedAt) {
      const promoted = await write('feedbacks', [
        `UPDATE feedbacks SET draft = 0, delivery_seq = promoted.next_seq, updated_at = ?
         FROM (
           SELECT id, (SELECT COALESCE(MAX(delivery_seq), 0) FROM feedbacks)
             + ROW_NUMBER() OVER (ORDER BY insertion_seq) AS next_seq
           FROM feedbacks WHERE artifact_id = ? AND round_id = ? AND draft = 1
         ) AS promoted WHERE feedbacks.id = promoted.id RETURNING 1`,
        updatedAt,
        artifactId,
        roundId,
      ])
      return promoted.length
    },
  }

  const receipts: ReceiptRepository = {
    async save(receipt) {
      await query(
        `INSERT INTO receipts (receipt, artifact_id, cursor, feedback_ids_json, issued_at)
         VALUES (?, ?, ?, ?, ?)`,
        receipt.receipt,
        receipt.artifactId,
        receipt.cursor,
        JSON.stringify(receipt.feedbackIds),
        receipt.issuedAt,
      )
    },
    // 删除并返回，天然只能消费一次
    async consume(id) {
      const row = await first<ReceiptRow>(
        `DELETE FROM receipts WHERE receipt = ? RETURNING ${receiptColumns}`,
        id,
      )
      if (!row) return undefined
      const { feedback_ids_json, ...receipt } = row
      return { ...receipt, feedbackIds: JSON.parse(feedback_ids_json) as string[] }
    },
  }

  const artifactStorage: ArtifactStorageRepository = {
    async read(namespace) {
      return (
        (await first<{ revision: number; json: string }>(
          'SELECT revision, json FROM artifact_kv WHERE namespace = ?',
          namespace,
        )) ?? null
      )
    },
    // revision 为 0 走插入（已存在则不改动），其余走带修订号条件的更新
    async compareAndSet(namespace, revision, json) {
      const rows =
        revision === 0
          ? await query(
              `INSERT INTO artifact_kv (namespace, revision, json) VALUES (?, 1, ?)
               ON CONFLICT(namespace) DO NOTHING RETURNING revision`,
              namespace,
              json,
            )
          : await query(
              `UPDATE artifact_kv SET revision = revision + 1, json = ?
               WHERE namespace = ? AND revision = ? RETURNING revision`,
              json,
              namespace,
              revision,
            )
      return rows.length > 0
    },
  }

  /**
   * 单行计数器自增并返回新序号。
   *
   * @remarks 每个序号都持久化，重启后不会回退或复用。
   */
  async function allocateRealtimeSeq(): Promise<number> {
    const row = await first<{ seq: string }>(
      `INSERT INTO hub_realtime_cursor (id, seq) VALUES (1, 0)
       ON CONFLICT(id) DO UPDATE SET seq = hub_realtime_cursor.seq + 1
       RETURNING CAST(seq AS TEXT) AS seq`,
    )
    const seq = Number(row?.seq)
    if (!Number.isSafeInteger(seq)) throw new Error('Hub 实时序号超出安全整数范围')
    return seq
  }

  return {
    projects,
    artifacts,
    states,
    rounds,
    feedbacks,
    receipts,
    artifactStorage,
    allocateRealtimeSeq,
    ready,
  }
}
