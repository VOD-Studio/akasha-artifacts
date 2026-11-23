import type { DatabaseSync } from 'node:sqlite'
import type {
  ArtifactStorageRepository,
  ArtifactStorageSnapshot,
} from '../../../domain/artifact-storage.js'

/** 在本地 Daemon 的 SQLite 库上挂载制品存储表。 */
export function createSqliteArtifactStorage(db: DatabaseSync): ArtifactStorageRepository {
  db.exec(`CREATE TABLE IF NOT EXISTS artifact_kv (
    namespace TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    json TEXT NOT NULL
  )`)
  const read = db.prepare('SELECT revision, json FROM artifact_kv WHERE namespace = ?')
  const insert = db.prepare(
    'INSERT INTO artifact_kv(namespace, revision, json) VALUES (?, 1, ?) ON CONFLICT(namespace) DO NOTHING',
  )
  const update = db.prepare(
    'UPDATE artifact_kv SET revision = revision + 1, json = ? WHERE namespace = ? AND revision = ?',
  )
  return {
    async read(namespace) {
      return (read.get(namespace) as ArtifactStorageSnapshot | undefined) ?? null
    },
    // revision 为 0 走插入（已存在则不改动），其余走带修订号条件的更新
    async compareAndSet(namespace, revision, json) {
      const { changes } =
        revision === 0 ? insert.run(namespace, json) : update.run(json, namespace, revision)
      return Number(changes) === 1
    },
  }
}
