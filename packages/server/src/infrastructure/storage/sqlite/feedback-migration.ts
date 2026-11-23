import type { DatabaseSync } from 'node:sqlite'

/** 在建表事务中升级既有反馈；NULL 保留以前创建和预览反馈的行为。 */
export function migrateFeedbackAudience(db: DatabaseSync): void {
  const column = db.prepare("SELECT 1 FROM pragma_table_info('feedbacks') WHERE name = 'audience'")
  if (!column.get()) db.exec('ALTER TABLE feedbacks ADD COLUMN audience TEXT')
}
