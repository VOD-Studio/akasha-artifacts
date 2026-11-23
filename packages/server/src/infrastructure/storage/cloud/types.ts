export type SqlValue = string | number | null
export type SqlStatement = [sql: string, ...params: SqlValue[]]
export type SqlWriteLock = 'schema' | 'rounds' | 'feedbacks'

export interface SqlDriver {
  jsonArrayValues: string
  execute<Row>(statement: SqlStatement): Promise<Row[]>
  batch<Row>(statements: SqlStatement[], lock?: SqlWriteLock): Promise<Row[]>
}

export interface VersionBlobs {
  get(key: string): Promise<string | null>
  put(key: string, source: string): Promise<void>
}
