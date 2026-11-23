import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createCloudStorage } from '../cloud/index.js'
import type { SqlStatement, VersionBlobs } from '../cloud/types.js'

/**
 * 用 node:sqlite 组装 Hub 的 SQLite 存储。
 *
 * @remarks 开启 WAL 与 5 秒忙等待。成组写入用 `BEGIN IMMEDIATE` 事务串行，
 * `lock` 参数在这里被忽略。
 */
export function createSqliteHubStorage(dbPath: string, blobs?: VersionBlobs) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON')
  function execute<Row>([sql, ...parameters]: SqlStatement): Row[] {
    return db.prepare(sql).all(...parameters) as Row[]
  }
  const storage = createCloudStorage(
    {
      jsonArrayValues: 'json_each(?)',
      async execute<Row>(statement: SqlStatement) {
        return execute<Row>(statement)
      },
      async batch<Row>(statements: SqlStatement[]) {
        db.exec('BEGIN IMMEDIATE')
        try {
          let rows: Row[] = []
          for (const statement of statements) rows = execute<Row>(statement)
          db.exec('COMMIT')
          return rows
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      },
    },
    blobs,
  )
  return { ...storage, close: () => db.close() }
}
