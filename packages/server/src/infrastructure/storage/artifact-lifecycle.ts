import type { Artifact, WithdrawnArtifact } from '@akasha/protocol'
import type { ArtifactLifecycleRepository } from '../../domain/ports.js'
import type { SqlStatement } from './cloud/types.js'

export const artifactLifecycleTable = `CREATE TABLE IF NOT EXISTS artifact_lifecycle (
  artifact_id TEXT PRIMARY KEY NOT NULL REFERENCES artifacts(public_id) ON DELETE CASCADE,
  withdrawn_at TEXT,
  share_generation INTEGER NOT NULL CHECK (share_generation > 0)
)`

/** 过滤读面，但底层仍占用原 publicId 和 slug，以便恢复而不是创建另一个制品。 */
export const activeArtifactOnly = `NOT EXISTS (SELECT 1 FROM artifact_lifecycle
  WHERE artifact_id = artifacts.public_id AND withdrawn_at IS NOT NULL)`

export const artifactColumns =
  'public_id AS "publicId", project_id AS "projectId", slug, title, type, visibility, head_version AS "headVersion", created_at AS "createdAt", updated_at AS "updatedAt"'

function mapWithdrawn({
  withdrawnAt,
  ...artifact
}: Artifact & { withdrawnAt: string }): WithdrawnArtifact {
  return { artifact, withdrawnAt }
}

/** 恢复只清撤下时间，从不回滚分享代数或重新发放旧凭证。 */
export function createSqlArtifactLifecycle(
  execute: <Row>(statement: SqlStatement) => Promise<Row[]>,
): ArtifactLifecycleRepository {
  type Entry = Artifact & { withdrawnAt: string }
  const withdrawn = `SELECT ${artifactColumns}, withdrawn_at AS "withdrawnAt"
    FROM artifacts JOIN artifact_lifecycle ON artifact_id = public_id WHERE withdrawn_at IS NOT NULL`
  return {
    async setWithdrawal(id, at) {
      const rows =
        at === null
          ? await execute([
              'UPDATE artifact_lifecycle SET withdrawn_at = NULL WHERE artifact_id = ? AND withdrawn_at IS NOT NULL RETURNING artifact_id',
              id,
            ])
          : await execute([
              `INSERT INTO artifact_lifecycle (artifact_id, withdrawn_at, share_generation)
             SELECT public_id, ?, 1 FROM artifacts WHERE public_id = ?
             ON CONFLICT (artifact_id) DO UPDATE SET withdrawn_at = excluded.withdrawn_at,
               share_generation = artifact_lifecycle.share_generation + 1
             WHERE artifact_lifecycle.withdrawn_at IS NULL RETURNING artifact_id`,
              at,
              id,
            ])
      return rows.length > 0
    },
    async findWithdrawn(id) {
      const [row] = await execute<Entry>([`${withdrawn} AND public_id = ?`, id])
      return row && mapWithdrawn(row)
    },
    async listWithdrawn() {
      return (await execute<Entry>([`${withdrawn} ORDER BY withdrawn_at DESC`])).map(mapWithdrawn)
    },
    async activeShareGeneration(id) {
      const [row] = await execute<{ generation: number }>([
        `SELECT COALESCE(share_generation, 0) AS generation FROM artifacts
         LEFT JOIN artifact_lifecycle ON artifact_id = public_id WHERE public_id = ? AND withdrawn_at IS NULL`,
        id,
      ])
      return row?.generation
    },
  }
}
