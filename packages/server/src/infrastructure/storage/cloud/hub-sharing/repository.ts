import type {
  HubGrant,
  HubSharingRepository,
  HubSharingScope,
} from '../../../../domain/hub-sharing.js'
import { defaultHubSharingPolicy, inheritedHubSharingOverride } from '../../hub-sharing-policy.js'
import type { SqlDriver, SqlStatement } from '../types.js'
import { createSqlIdentityStore } from './identity.js'

interface GrantRow {
  id: string
  artifact_id: string
  generation: number
  target_kind: HubGrant['target']['kind']
  target_value: string
  subject_id: string | null
  accepted_user_id: string | null
  role: HubGrant['role']
  expires_at: string
  entry_json: string
}

interface ScopeRow {
  restricted: number
  external_links: number | null
  external_email: number | null
}

const scopeColumns = 'restricted, external_links, external_email'
const mapScope = (row: ScopeRow): HubSharingScope => ({
  restricted: row.restricted === 1,
  override: {
    externalLinks: row.external_links === null ? null : row.external_links === 1,
    externalEmail: row.external_email === null ? null : row.external_email === 1,
  },
})

const grantColumns = `id, artifact_id, generation, target_kind, target_value, subject_id,
  accepted_user_id, role, expires_at, entry_json`

function targetValue(target: HubGrant['target']): string {
  switch (target.kind) {
    case 'member':
      return target.login
    case 'email':
      return target.email
    case 'group':
      return target.slug
    default:
      return ''
  }
}

function grantTarget(kind: GrantRow['target_kind'], value: string): HubGrant['target'] {
  switch (kind) {
    case 'member':
      return { kind, login: value }
    case 'email':
      return { kind, email: value }
    case 'group':
      return { kind, slug: value }
    default:
      return { kind }
  }
}

const mapGrant = (row: GrantRow): HubGrant => ({
  id: row.id,
  artifactId: row.artifact_id,
  generation: row.generation,
  target: grantTarget(row.target_kind, row.target_value),
  subjectId: row.subject_id,
  acceptedUserId: row.accepted_user_id,
  role: row.role,
  expiresAt: row.expires_at,
  entry: JSON.parse(row.entry_json),
})

// 范围行也是制品级写锁。普通链接同样取锁，但不能解除已有的 restricted。
const enterScope = (artifactId: string, restrict: boolean): SqlStatement => [
  `INSERT INTO hub_sharing_scopes (artifact_id, restricted) VALUES (?, ?)
   ON CONFLICT (artifact_id) DO UPDATE SET restricted = CASE WHEN excluded.restricted = 1
     THEN 1 ELSE hub_sharing_scopes.restricted END`,
  artifactId,
  Number(restrict),
]

/** 授权变更只作用于对应制品；首次接受依靠条件更新竞争，绝不插入新的授权行。 */
export function createSqlHubSharingRepository(
  execute: SqlDriver['execute'],
  batch: (statements: SqlStatement[]) => Promise<void>,
  jsonArrayValues: string,
): HubSharingRepository {
  return {
    ...createSqlIdentityStore(execute, batch, jsonArrayValues),
    async getDefaults() {
      const [row] = await execute<{ external_links: number; external_email: number }>([
        'SELECT external_links, external_email FROM hub_sharing_defaults WHERE id = 1',
      ])
      if (!row) return { ...defaultHubSharingPolicy }
      return { externalLinks: row.external_links === 1, externalEmail: row.external_email === 1 }
    },
    async setDefaults(policy) {
      await execute([
        `INSERT INTO hub_sharing_defaults (id, external_links, external_email) VALUES (1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET external_links = excluded.external_links,
           external_email = excluded.external_email`,
        Number(policy.externalLinks),
        Number(policy.externalEmail),
      ])
    },
    async getScope(artifactId) {
      const [row] = await execute<ScopeRow>([
        `SELECT ${scopeColumns} FROM hub_sharing_scopes WHERE artifact_id = ?`,
        artifactId,
      ])
      if (!row) return { restricted: false, override: { ...inheritedHubSharingOverride } }
      return mapScope(row)
    },
    async getScopes(artifactIds) {
      const result = new Map<string, HubSharingScope>()
      if (!artifactIds.length) return result
      const rows = await execute<ScopeRow & { artifact_id: string }>([
        `SELECT artifact_id, ${scopeColumns} FROM hub_sharing_scopes
         WHERE artifact_id IN (SELECT value FROM ${jsonArrayValues})`,
        JSON.stringify(artifactIds),
      ])
      for (const row of rows) result.set(row.artifact_id, mapScope(row))
      return result
    },
    async setOverride(artifactId, override) {
      await execute([
        `INSERT INTO hub_sharing_scopes (artifact_id, external_links, external_email) VALUES (?, ?, ?)
         ON CONFLICT (artifact_id) DO UPDATE SET external_links = excluded.external_links,
           external_email = excluded.external_email`,
        artifactId,
        override.externalLinks === null ? null : Number(override.externalLinks),
        override.externalEmail === null ? null : Number(override.externalEmail),
      ])
    },
    async restrictToOwner(artifactId) {
      await batch([
        enterScope(artifactId, true),
        // 目录查询可以跨越本事务；持旧代数的签发请求不得在另一个连接上恢复访问。
        [
          `INSERT INTO artifact_lifecycle (artifact_id, withdrawn_at, share_generation) VALUES (?, NULL, 1)
           ON CONFLICT (artifact_id) DO UPDATE SET share_generation = artifact_lifecycle.share_generation + 1
           WHERE artifact_lifecycle.withdrawn_at IS NULL`,
          artifactId,
        ],
        ['DELETE FROM hub_sharing_grants WHERE artifact_id = ?', artifactId],
      ])
    },
    async createGrant(grant) {
      await batch([
        enterScope(grant.artifactId, grant.target.kind !== 'link'),
        [
          `INSERT INTO hub_sharing_grants (${grantColumns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          grant.id,
          grant.artifactId,
          grant.generation,
          grant.target.kind,
          targetValue(grant.target),
          grant.subjectId,
          grant.acceptedUserId,
          grant.role,
          grant.expiresAt,
          JSON.stringify(grant.entry),
        ],
      ])
    },
    async listGrants(artifactId, generation) {
      const rows = await execute<GrantRow>([
        `SELECT ${grantColumns} FROM hub_sharing_grants
         WHERE artifact_id = ? AND generation = ? ORDER BY id`,
        artifactId,
        generation,
      ])
      return rows.map(mapGrant)
    },
    async getGrant(id) {
      const [row] = await execute<GrantRow>([
        `SELECT ${grantColumns} FROM hub_sharing_grants WHERE id = ?`,
        id,
      ])
      return row && mapGrant(row)
    },
    async acceptGrant(id, userId) {
      const rows = await execute([
        `UPDATE hub_sharing_grants SET accepted_user_id = ? WHERE id = ?
         AND (target_kind = 'email' OR (target_kind = 'member' AND subject_id = ?))
         AND (accepted_user_id IS NULL OR accepted_user_id = ?) RETURNING id`,
        userId,
        id,
        userId,
        userId,
      ])
      return rows.length > 0
    },
    async changeRole(artifactId, id, role) {
      const rows = await execute([
        'UPDATE hub_sharing_grants SET role = ? WHERE artifact_id = ? AND id = ? RETURNING id',
        role,
        artifactId,
        id,
      ])
      return rows.length > 0
    },
    async revokeGrant(artifactId, id) {
      const rows = await execute([
        'DELETE FROM hub_sharing_grants WHERE artifact_id = ? AND id = ? RETURNING id',
        artifactId,
        id,
      ])
      return rows.length > 0
    },
  }
}
