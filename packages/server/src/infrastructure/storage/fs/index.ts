import fs from 'node:fs'
import path from 'node:path'
import type { PublicId } from '@akasha/protocol'
import type {
  FeedbackRepository,
  ProjectRepository,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'
import { SqliteStorage } from '../sqlite/index.js'
import { FsArtifactRepository } from './artifact-repository.js'
import { STATE_DIR_NAME } from './file-layout.js'

export { FsArtifactRepository } from './artifact-repository.js'
export {
  ARTIFACT_ID_FILENAME,
  type ArtifactFileLayout,
  assertRealPathInsideRoot,
  entryFilenameForType,
  type ParsedFsArtifactPath,
  parseArtifactPathFromFs,
  resolveArtifactFileLayout,
  STATE_DIR_NAME,
} from './file-layout.js'

export interface FsArtifactsStorageOptions {
  artifactsRoot: string
  // 该存储绑定的业务项目根目录（独立于 artifactsRoot，兼容 --artifacts-dir 指向子目录或外部缓存路径）
  projectRoot?: string
  // 缺省时依次取同根目录已登记的项目、meta 里的记录、最近活跃的项目，最后回退为 default
  projectId?: string
}

/**
 * 项目内 `.artifacts/` 原生文件存储适配器。
 *
 * @remarks 源码按 `<type>/<slug>/<入口文件>` 落盘并附 `.artifact-id` 稳定标识，可纳入 Git、
 * 也可由宿主直接编辑。评论、轮次、回执、状态流与版本索引由服务端独占存放在
 * `.artifacts/.state/state.db`，不与源码编辑冲突。
 */
export class FsArtifactsStorage {
  readonly artifactsRoot: string
  readonly projectRoot: string
  readonly projectId: string
  readonly stateDir: string
  readonly stateDbPath: string
  private readonly sqlite: SqliteStorage
  readonly projects: ProjectRepository
  readonly artifacts: FsArtifactRepository
  readonly states: StateRepository
  readonly rounds: RoundRepository
  readonly feedbacks: FeedbackRepository
  readonly receipts: ReceiptRepository
  readonly artifactStorage: SqliteStorage['artifactStorage']

  constructor(options: FsArtifactsStorageOptions) {
    this.artifactsRoot = path.resolve(options.artifactsRoot)
    this.projectRoot = path.resolve(options.projectRoot ?? path.dirname(this.artifactsRoot))
    this.stateDir = path.join(this.artifactsRoot, STATE_DIR_NAME)
    this.stateDbPath = path.join(this.stateDir, 'state.db')

    fs.mkdirSync(this.stateDir, { recursive: true })
    this.sqlite = new SqliteStorage(this.stateDbPath)

    let resolvedProjectId = options.projectId
    if (!resolvedProjectId) {
      const byRoot = this.sqlite.db
        .prepare('SELECT id FROM projects WHERE root_path = ?')
        .get(this.projectRoot) as { id: string } | undefined
      const byMeta = this.sqlite.db
        .prepare("SELECT value FROM meta WHERE key = 'fs_project_id'")
        .get() as { value: string } | undefined
      const fallbackExisting = this.sqlite.db
        .prepare('SELECT id FROM projects ORDER BY last_active_at DESC LIMIT 1')
        .get() as { id: string } | undefined
      resolvedProjectId = byRoot?.id ?? byMeta?.value ?? fallbackExisting?.id ?? 'default'
    }
    this.projectId = resolvedProjectId

    // 登记并刷新当前 .artifacts/ 所属项目的最新根目录（兼容项目目录整体改名/迁移后保留原 projectId，确保宿主按新 projectDir 登记命中同一项目）
    this.sqlite.db.exec('BEGIN IMMEDIATE')
    try {
      this.sqlite.db
        .prepare('DELETE FROM projects WHERE root_path = ? AND id != ?')
        .run(this.projectRoot, this.projectId)
      this.sqlite.db
        .prepare(
          `INSERT INTO projects (id, root_path, name, last_active_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             root_path = excluded.root_path,
             name = excluded.name,
             last_active_at = excluded.last_active_at`,
        )
        .run(
          this.projectId,
          this.projectRoot,
          path.basename(this.projectRoot) || this.projectId,
          new Date().toISOString(),
        )
      this.sqlite.db
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('fs_project_id', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(this.projectId)
      this.sqlite.db.exec('COMMIT')
    } catch (err) {
      this.sqlite.db.exec('ROLLBACK')
      throw err
    }

    this.projects = this.sqlite.projects
    this.artifacts = new FsArtifactRepository(
      this.artifactsRoot,
      this.projectId,
      this.sqlite.artifacts,
    )
    this.states = this.sqlite.states
    this.rounds = this.sqlite.rounds
    this.feedbacks = this.sqlite.feedbacks
    this.receipts = this.sqlite.receipts
    this.artifactStorage = this.sqlite.artifactStorage
  }

  getEventSeq(): number {
    return this.sqlite.getEventSeq()
  }

  setEventSeq(seq: number): void {
    this.sqlite.setEventSeq(seq)
  }

  findProjectIdByArtifactSync(publicId: PublicId): string | undefined {
    return this.sqlite.findProjectIdByArtifactSync(publicId)
  }

  close(): void {
    this.sqlite.close()
  }
}
