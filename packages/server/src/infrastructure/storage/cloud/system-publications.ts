import type {
  NamedSystemPin,
  NamedSystemRepository,
  SystemPublication,
} from '../../../domain/team-systems.js'
import type { SqlDriver, SqlStatement } from './types.js'

const keyColumns = 'project_id, artifact_id, version, generation'

/** 单行默认指针只引用已有发布；撤回保留发布记录以覆盖仍存在的个人授权。 */
export const systemPublicationSchema: SqlStatement[] = [
  [
    `CREATE TABLE IF NOT EXISTS hub_system_publications (
      project_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifacts(public_id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      generation INTEGER NOT NULL CHECK (generation >= 0),
      withdrawn INTEGER NOT NULL CHECK (withdrawn IN (0, 1)),
      PRIMARY KEY (${keyColumns}),
      FOREIGN KEY (artifact_id, version) REFERENCES versions(artifact_id, version) ON DELETE CASCADE
    )`,
  ],
  [
    `CREATE TABLE IF NOT EXISTS hub_system_default (
      slot INTEGER PRIMARY KEY CHECK (slot = 1),
      project_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      generation INTEGER NOT NULL,
      FOREIGN KEY (${keyColumns}) REFERENCES hub_system_publications(${keyColumns}) ON DELETE CASCADE
    )`,
  ],
]

const activePublication = `FROM hub_system_publications p
  JOIN artifacts a ON a.public_id = p.artifact_id AND a.project_id = p.project_id
    AND a.type = 'design-system'
  LEFT JOIN artifact_lifecycle l ON l.artifact_id = p.artifact_id
  WHERE l.withdrawn_at IS NULL AND p.generation = COALESCE(l.share_generation, 0)`
const matchesPin = 'p.project_id = ? AND p.artifact_id = ? AND p.version = ? AND p.generation = ?'
const eligible = `SELECT p.project_id, p.artifact_id, p.version, p.generation ${activePublication}
  AND ${matchesPin} AND p.withdrawn = 0`
const selectPublications = `SELECT p.project_id AS "projectId", p.artifact_id AS id, p.version,
  p.generation, p.withdrawn, CASE WHEN EXISTS (SELECT 1 FROM hub_system_default d
  WHERE d.project_id = p.project_id AND d.artifact_id = p.artifact_id AND d.version = p.version
    AND d.generation = p.generation) THEN 1 ELSE 0 END AS "isDefault" ${activePublication}`

type PublicationRow = NamedSystemPin & { withdrawn: number; isDefault: number }

const fromRow = ({ withdrawn, isDefault, ...pin }: PublicationRow): SystemPublication => ({
  ...pin,
  withdrawn: withdrawn === 1,
  isDefault: isDefault === 1,
})

/** 发布、默认和撤回在同一团队锁下变更；撤回的版本再发布时不会自动取回默认指针。 */
export function createSqlSystemPublications(
  execute: SqlDriver['execute'],
  batch: SqlDriver['batch'],
): Pick<NamedSystemRepository, 'listPublications' | 'publication' | 'setPublication'> {
  return {
    async listPublications() {
      return (await execute<PublicationRow>([selectPublications])).map(fromRow)
    },
    async publication({ projectId, id, version, generation }) {
      const [row] = await execute<PublicationRow>([
        `${selectPublications} AND ${matchesPin}`,
        projectId,
        id,
        version,
        generation,
      ])
      return row && fromRow(row)
    },
    async setPublication({ projectId, id, version, generation }, action) {
      const key = [projectId, id, version, generation] as const
      const statements: SqlStatement[] = []
      switch (action) {
        case 'publish':
          statements.push([
            `INSERT INTO hub_system_publications (${keyColumns}, withdrawn)
             SELECT a.project_id, a.public_id, v.version, COALESCE(l.share_generation, 0), 0
             FROM artifacts a JOIN versions v ON v.artifact_id = a.public_id
             LEFT JOIN artifact_lifecycle l ON l.artifact_id = a.public_id
             WHERE a.project_id = ? AND a.public_id = ? AND v.version = ?
               AND COALESCE(l.share_generation, 0) = ? AND l.withdrawn_at IS NULL AND a.type = 'design-system'
             ON CONFLICT (${keyColumns}) DO UPDATE SET withdrawn = 0 RETURNING version`,
            ...key,
          ])
          break
        case 'default':
          statements.push([
            `INSERT INTO hub_system_default (slot, ${keyColumns})
             SELECT 1, p.project_id, p.artifact_id, p.version, p.generation ${activePublication}
             AND ${matchesPin} AND p.withdrawn = 0
             ON CONFLICT (slot) DO UPDATE SET project_id = excluded.project_id, artifact_id = excluded.artifact_id,
               version = excluded.version, generation = excluded.generation RETURNING slot`,
            ...key,
          ])
          break
        case 'clear-default':
          statements.push([
            `DELETE FROM hub_system_default WHERE (${keyColumns}) IN (${eligible}) RETURNING slot`,
            ...key,
          ])
          break
        case 'withdraw':
          statements.push(
            [`DELETE FROM hub_system_default WHERE (${keyColumns}) IN (${eligible})`, ...key],
            [
              `UPDATE hub_system_publications SET withdrawn = 1 WHERE (${keyColumns}) IN (${eligible}) RETURNING version`,
              ...key,
            ],
          )
          break
      }
      return (await batch(statements, 'systemPublications')).length > 0
    },
  }
}
