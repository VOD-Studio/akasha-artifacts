import type { AnnotationThread, Author, PublicId } from '@akasha/protocol'
import type { AnnotationRepository } from '../../domain/ports.js'
import type { SqlStatement } from './cloud/types.js'

const resolutionId = 'resolution'

/** 讨论数据不写入反馈表；空正文仅表示每条线程唯一的解决记录。 */
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
]

interface AnnotationRow {
  feedbackId: string
  id: string
  body: string | null
  author: Author
  createdAt: string
}

/** 查询时按根批注的制品与草稿权限裁剪讨论，解决和回复均不消费反馈回执。 */
export function createSqlAnnotationRepository(
  execute: <Row>(statement: SqlStatement) => Promise<Row[]>,
): AnnotationRepository {
  return {
    async list(artifactId: PublicId, includeDrafts: boolean) {
      const rows = await execute<AnnotationRow>([
        `SELECT records.feedback_id AS "feedbackId", records.id, records.body, records.author,
          records.created_at AS "createdAt"
         FROM annotation_records AS records JOIN feedbacks ON feedbacks.id = records.feedback_id
         WHERE feedbacks.artifact_id = ?${includeDrafts ? '' : ' AND feedbacks.draft = 0'}
         ORDER BY records.created_at, records.id`,
        artifactId,
      ])
      const threads: Record<string, AnnotationThread> = Object.create(null)
      for (const { feedbackId, id, body, author, createdAt } of rows) {
        threads[feedbackId] ??= { replies: [], resolution: null }
        const thread = threads[feedbackId]
        if (body === null) thread.resolution = { author, resolvedAt: createdAt }
        else thread.replies.push({ id, author, body, createdAt })
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
  }
}
