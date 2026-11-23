export type SqlValue = string | number | null
export type SqlStatement = [sql: string, ...params: SqlValue[]]
/** 成组写入的互斥范围；PostgreSQL 驱动据此取事务级咨询锁，SQLite 驱动靠事务本身串行。 */
export type SqlWriteLock = 'schema' | 'rounds' | 'feedbacks'

export interface SqlDriver {
  // 把单个 JSON 数组参数展开为多行的 SQL 片段，占位符为 ?；各数据库的展开函数不同
  jsonArrayValues: string
  /** 执行单条语句，返回全部结果行。 */
  execute<Row>(statement: SqlStatement): Promise<Row[]>
  /** 在一个事务内按序执行，返回最后一条语句的结果；给出 `lock` 时整个事务持有对应的写锁。 */
  batch<Row>(statements: SqlStatement[], lock?: SqlWriteLock): Promise<Row[]>
}

/** 版本源码的对象存储；配置后 `versions` 表只存对象键。 */
export interface VersionBlobs {
  /** 对象不存在时返回 `null`。 */
  get(key: string): Promise<string | null>
  put(key: string, source: string): Promise<void>
}
