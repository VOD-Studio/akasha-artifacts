import type { ArtboardContent, ArtboardIndex, ArtboardProjection, PublicId } from '@akasha/protocol'
import type { BoardProjectionRepository } from '../../domain/ports.js'
import type { SqlStatement } from './cloud/types.js'

/** 只附加可重建的副本，既有 SQLite 和 PostgreSQL 无需重写版本表。 */
export const boardProjectionSchema: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS artboard_indexes (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      index_json TEXT NOT NULL,
      PRIMARY KEY (artifact_id, version),
      FOREIGN KEY (artifact_id, version) REFERENCES versions (artifact_id, version)
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS artboard_contents (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      board_id TEXT NOT NULL,
      content_json TEXT NOT NULL,
      PRIMARY KEY (artifact_id, version, board_id),
      FOREIGN KEY (artifact_id, version) REFERENCES artboard_indexes (artifact_id, version)
    )`,
  ],
]

/** 调用方须在单个事务内保存整批，避免并发读取半成品。 */
export function boardProjectionStatements(
  artifactId: PublicId,
  version: number,
  projection: ArtboardProjection | null,
): SqlStatement[] {
  const statements: SqlStatement[] = [
    [
      `INSERT INTO artboard_indexes (artifact_id, version, index_json) VALUES (?, ?, ?)
       ON CONFLICT (artifact_id, version) DO NOTHING`,
      artifactId,
      version,
      JSON.stringify(projection?.index ?? null),
    ],
  ]
  for (const board of projection?.contents ?? []) {
    statements.push([
      `INSERT INTO artboard_contents (artifact_id, version, board_id, content_json) VALUES (?, ?, ?, ?)
       ON CONFLICT (artifact_id, version, board_id) DO NOTHING`,
      artifactId,
      version,
      board.id,
      JSON.stringify(board),
    ])
  }
  return statements
}

/** 读取单板不会加载整稿或其他板的正文。 */
export function createSqlBoardProjectionRepository(
  first: <Row>(statement: SqlStatement) => Promise<Row | undefined>,
  write: (statements: SqlStatement[]) => Promise<unknown>,
): BoardProjectionRepository {
  return {
    async getIndex(artifactId, version) {
      const row = await first<{ index_json: string }>([
        'SELECT index_json FROM artboard_indexes WHERE artifact_id = ? AND version = ?',
        artifactId,
        version,
      ])
      return row && (JSON.parse(row.index_json) as ArtboardIndex | null)
    },
    async getBoard(artifactId, version, boardId) {
      const row = await first<{ content_json: string }>([
        'SELECT content_json FROM artboard_contents WHERE artifact_id = ? AND version = ? AND board_id = ?',
        artifactId,
        version,
        boardId,
      ])
      return row && (JSON.parse(row.content_json) as ArtboardContent)
    },
    async save(artifactId, version, projection) {
      await write(boardProjectionStatements(artifactId, version, projection))
    },
  }
}
