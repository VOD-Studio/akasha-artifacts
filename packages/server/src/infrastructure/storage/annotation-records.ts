import type {
  AgentPublication,
  AnnotationAgentDelivery,
  AnnotationAgentState,
  AnnotationThread,
  Author,
  PublicId,
} from '@akasha/protocol'
import type { AnnotationRepository } from '../../domain/ports.js'
import type { SqlStatement } from './cloud/types.js'

const resolutionId = 'resolution'

/** 讨论数据与已绑定 Agent 执行回执均不写入反馈队列，按 feedback_id 级联清理。 */
export const annotationStatements: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS annotation_records (
      feedback_id TEXT NOT NULL REFERENCES feedbacks(id) ON DELETE CASCADE,
      id TEXT NOT NULL,
      body TEXT,
      author TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK ((id = 'resolution') = (body IS NULL)),
      PRIMARY KEY (feedback_id, id)
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS annotation_agent_deliveries (
      feedback_id TEXT PRIMARY KEY REFERENCES feedbacks(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      session_id TEXT,
      turn_id TEXT,
      reply TEXT,
      error TEXT,
      publications_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  ],
]

interface AnnotationRow {
  feedbackId: string
  id: string
  body: string | null
  author: Author
  createdAt: string
}

interface AgentDeliveryRow {
  feedbackId: string
  state: AnnotationAgentState
  sessionId: string | null
  turnId: string | null
  reply: string | null
  error: string | null
  publicationsJson: string
  updatedAt: string
}

function mapAgentDelivery(row: AgentDeliveryRow): AnnotationAgentDelivery {
  return {
    state: row.state,
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.turnId ? { turnId: row.turnId } : {}),
    ...(row.reply !== null ? { reply: row.reply } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    publications: JSON.parse(row.publicationsJson) as AgentPublication[],
    updatedAt: row.updatedAt,
  }
}

/** 查询时按根批注的制品与草稿权限裁剪讨论，解决和回复均不消费反馈回执。 */
export function createSqlAnnotationRepository(
  execute: <Row>(statement: SqlStatement) => Promise<Row[]>,
): AnnotationRepository {
  return {
    async list(artifactId: PublicId, includeDrafts: boolean) {
      const draftFilter = includeDrafts ? '' : ' AND feedbacks.draft = 0'
      const [rows, deliveries] = await Promise.all([
        execute<AnnotationRow>([
          `SELECT records.feedback_id AS "feedbackId", records.id, records.body, records.author,
            records.created_at AS "createdAt"
           FROM annotation_records AS records JOIN feedbacks ON feedbacks.id = records.feedback_id
           WHERE feedbacks.artifact_id = ?${draftFilter}
           ORDER BY records.created_at, records.id`,
          artifactId,
        ]),
        execute<AgentDeliveryRow>([
          `SELECT deliveries.feedback_id AS "feedbackId", deliveries.state,
            deliveries.session_id AS "sessionId", deliveries.turn_id AS "turnId",
            deliveries.reply, deliveries.error, deliveries.publications_json AS "publicationsJson",
            deliveries.updated_at AS "updatedAt"
           FROM annotation_agent_deliveries AS deliveries
           JOIN feedbacks ON feedbacks.id = deliveries.feedback_id
           WHERE feedbacks.artifact_id = ?${draftFilter}`,
          artifactId,
        ]),
      ])
      const threads: Record<string, AnnotationThread> = Object.create(null)
      for (const { feedbackId, id, body, author, createdAt } of rows) {
        threads[feedbackId] ??= { replies: [], resolution: null }
        const thread = threads[feedbackId]
        if (body === null) thread.resolution = { author, resolvedAt: createdAt }
        else thread.replies.push({ id, author, body, createdAt })
      }
      for (const row of deliveries) {
        threads[row.feedbackId] ??= { replies: [], resolution: null }
        threads[row.feedbackId].agent = mapAgentDelivery(row)
      }
      return threads
    },
    async reply(feedbackId, { id, body, author, createdAt }) {
      await execute([
        'INSERT INTO annotation_records (feedback_id, id, body, author, created_at) VALUES (?, ?, ?, ?, ?)',
        feedbackId,
        id,
        body,
        author,
        createdAt,
      ])
    },
    async setResolution(feedbackId, resolution) {
      if (resolution) {
        await execute([
          `INSERT INTO annotation_records (feedback_id, id, author, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (feedback_id, id) DO NOTHING`,
          feedbackId,
          resolutionId,
          resolution.author,
          resolution.resolvedAt,
        ])
      } else {
        await execute([
          'DELETE FROM annotation_records WHERE feedback_id = ? AND id = ?',
          feedbackId,
          resolutionId,
        ])
      }
    },
    async claimAgentDelivery(feedbackId, delivery) {
      const inserted = await execute<{ feedbackId: string }>([
        `INSERT INTO annotation_agent_deliveries
           (feedback_id, state, session_id, turn_id, reply, error, publications_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (feedback_id) DO NOTHING
         RETURNING feedback_id AS "feedbackId"`,
        feedbackId,
        delivery.state,
        delivery.sessionId ?? null,
        delivery.turnId ?? null,
        delivery.reply ?? null,
        delivery.error ?? null,
        JSON.stringify(delivery.publications),
        delivery.updatedAt,
      ])
      return inserted.length > 0
    },
    async setAgentDelivery(feedbackId, delivery) {
      await execute([
        `INSERT INTO annotation_agent_deliveries
           (feedback_id, state, session_id, turn_id, reply, error, publications_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (feedback_id) DO UPDATE SET
           state = excluded.state,
           session_id = excluded.session_id,
           turn_id = excluded.turn_id,
           reply = excluded.reply,
           error = excluded.error,
           publications_json = excluded.publications_json,
           updated_at = excluded.updated_at`,
        feedbackId,
        delivery.state,
        delivery.sessionId ?? null,
        delivery.turnId ?? null,
        delivery.reply ?? null,
        delivery.error ?? null,
        JSON.stringify(delivery.publications),
        delivery.updatedAt,
      ])
    },
    async compareAndSetAgentDelivery(feedbackId, expected, next) {
      const updated = await execute<{ feedbackId: string }>([
        `UPDATE annotation_agent_deliveries
         SET state = ?, session_id = ?, turn_id = ?, reply = ?, error = ?, publications_json = ?, updated_at = ?
         WHERE feedback_id = ? AND state = ? AND updated_at = ?
         RETURNING feedback_id AS "feedbackId"`,
        next.state,
        next.sessionId ?? null,
        next.turnId ?? null,
        next.reply ?? null,
        next.error ?? null,
        JSON.stringify(next.publications),
        next.updatedAt,
        feedbackId,
        expected.state,
        expected.updatedAt,
      ])
      if (updated.length > 0) return next
      return this.getAgentDelivery(feedbackId)
    },
    async getAgentDelivery(feedbackId) {
      const rows = await execute<AgentDeliveryRow>([
        `SELECT feedback_id AS "feedbackId", state, session_id AS "sessionId",
          turn_id AS "turnId", reply, error, publications_json AS "publicationsJson",
          updated_at AS "updatedAt"
         FROM annotation_agent_deliveries
         WHERE feedback_id = ?`,
        feedbackId,
      ])
      return rows[0] ? mapAgentDelivery(rows[0]) : undefined
    },
  }
}
