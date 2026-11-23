import { Pool } from 'pg'
import { createCloudStorage } from '../cloud/index.js'
import type { SqlStatement, SqlWriteLock, VersionBlobs } from '../cloud/types.js'

export interface PostgresStorageOptions {
  connectionString: string
  blobs?: VersionBlobs
}

const locks: Record<SqlWriteLock, number> = { schema: 1, rounds: 2, feedbacks: 3 }
const lockNamespace = 0x414b4153

function toPostgres([sql, ...values]: SqlStatement) {
  let position = 0
  return { text: sql.replace(/\?/g, () => `$${++position}`), values }
}

export function createPostgresStorage({ connectionString, blobs }: PostgresStorageOptions) {
  const pool = new Pool({ connectionString })
  pool.on('error', (error) => {
    console.error('PostgreSQL 空闲连接异常', error)
  })
  const storage = createCloudStorage(
    {
      jsonArrayValues: 'json_array_elements_text(CAST(? AS JSON)) AS artifact_scope(value)',
      async execute<Row>(statement: SqlStatement) {
        const result = await pool.query(toPostgres(statement))
        return result.rows as unknown as Row[]
      },
      async batch<Row>(statements: SqlStatement[], lock?: SqlWriteLock) {
        const client = await pool.connect()
        let connectionError: Error | undefined
        try {
          await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
          // 获取锁后的语句需要看到前一写入者刚提交的数据，不能复用取锁时的快照。
          if (lock) {
            await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockNamespace, locks[lock]])
          }
          let rows: Row[] = []
          for (const statement of statements) {
            const result = await client.query(toPostgres(statement))
            rows = result.rows as unknown as Row[]
          }
          await client.query('COMMIT')
          return rows
        } catch (error) {
          try {
            await client.query('ROLLBACK')
          } catch {
            connectionError = new Error('PostgreSQL 事务无法回滚')
          }
          throw error
        } finally {
          client.release(connectionError)
        }
      },
    },
    blobs,
  )
  return { ...storage, close: () => pool.end() }
}
