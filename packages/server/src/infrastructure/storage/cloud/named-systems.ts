import type {
  NamedSystemMember,
  NamedSystemPin,
  NamedSystemRepository,
} from '../../../domain/team-systems.js'
import type { SqlDriver, SqlStatement } from './types.js'

/** 成员索引只覆盖显式授权；名单行不参与制品或项目自身的访问控制。 */
export const namedSystemSchema: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS hub_named_system_members (
      project_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifacts(public_id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 0),
      user_id TEXT NOT NULL,
      login TEXT NOT NULL,
      ord INTEGER NOT NULL,
      PRIMARY KEY (project_id, artifact_id, version, generation, user_id),
      FOREIGN KEY (artifact_id, version) REFERENCES versions(artifact_id, version) ON DELETE CASCADE
    )`,
  ],
  ['CREATE INDEX IF NOT EXISTS idx_hub_named_system_user ON hub_named_system_members (user_id)'],
]

const pinMatch = 'project_id = ? AND artifact_id = ? AND version = ? AND generation = ?'

/** SQLite 和 PostgreSQL 共用事务替换名单；不同连接不会合并两个所有者请求的结果。 */
export function createSqlNamedSystemRepository(
  execute: SqlDriver['execute'],
  batch: (statements: SqlStatement[]) => Promise<void>,
): NamedSystemRepository {
  return {
    listNamed: (userId) =>
      execute<NamedSystemPin>([
        `SELECT m.project_id AS "projectId", m.artifact_id AS id, m.version, m.generation
         FROM hub_named_system_members m
         JOIN artifacts a ON a.public_id = m.artifact_id AND a.project_id = m.project_id
         LEFT JOIN artifact_lifecycle l ON l.artifact_id = m.artifact_id
         WHERE m.user_id = ? AND l.withdrawn_at IS NULL AND m.generation = COALESCE(l.share_generation, 0)`,
        userId,
      ]),
    getMembers: ({ projectId, id, version, generation }) =>
      execute<NamedSystemMember>([
        `SELECT user_id AS "userId", login FROM hub_named_system_members WHERE ${pinMatch} ORDER BY ord`,
        projectId,
        id,
        version,
        generation,
      ]),
    async setMembers({ projectId, id, version, generation }, members) {
      // 空名单也要有可锁的行：同一制品的替换先取写锁，不更改制品的更新时间。
      const statements: SqlStatement[] = [
        ['UPDATE artifacts SET updated_at = updated_at WHERE public_id = ?', id],
        [
          `DELETE FROM hub_named_system_members WHERE ${pinMatch}`,
          projectId,
          id,
          version,
          generation,
        ],
      ]
      for (const [ord, { userId, login }] of members.entries()) {
        statements.push([
          `INSERT INTO hub_named_system_members (project_id, artifact_id, version, generation, user_id, login, ord)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          projectId,
          id,
          version,
          generation,
          userId,
          login,
          ord,
        ])
      }
      await batch(statements)
    },
  }
}
