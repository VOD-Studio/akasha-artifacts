import {
  type ArtboardIndex,
  type Artifact,
  projectArtboard,
  type WorkspaceVersion,
} from '@akasha/protocol'
import type { ArtifactRepository } from '../domain/ports.js'
import { KeyedAsyncLock } from './keyed-lock.js'

/** 必须先由调用方取得有权限读取的活动制品，再按指定版本读取派生数据。 */
export class ArtifactWorkspaceRead {
  private readonly rebuilds = new KeyedAsyncLock()

  constructor(private readonly artifacts: ArtifactRepository) {}

  /** 多画板不返回源码；旧的不合法稿仍交给原渲染器显示解析错误。 */
  async getVersion(artifact: Artifact, version: number): Promise<WorkspaceVersion | undefined> {
    if (artifact.type === 'artboard') {
      const canvas = await this.ensureIndex(artifact, version)
      if (canvas) {
        const [summary] = await this.artifacts.getVersionSummaries(artifact.publicId, version)
        return summary && { version: summary, canvas }
      }
    }
    const snapshot = await this.artifacts.getVersion(artifact.publicId, version)
    return snapshot && { version: snapshot }
  }

  /** 记录由制品、版本和板标识共同定位；找不到时不改读头版。 */
  async getBoard(artifact: Artifact, version: number, boardId: string) {
    if (artifact.type !== 'artboard') return undefined
    const { boardProjections } = this.artifacts
    const board = await boardProjections.getBoard(artifact.publicId, version, boardId)
    if (board) return board
    const index = await this.ensureIndex(artifact, version)
    if (!index?.boards.some(({ id }) => id === boardId)) return undefined
    return boardProjections.getBoard(artifact.publicId, version, boardId)
  }

  private async ensureIndex(artifact: Artifact, version: number): Promise<ArtboardIndex | null> {
    const { publicId } = artifact
    const { boardProjections } = this.artifacts
    const cached = await boardProjections.getIndex(publicId, version)
    if (cached !== undefined) return cached
    return this.rebuilds.run(`${publicId}:${version}`, async () => {
      const latest = await boardProjections.getIndex(publicId, version)
      if (latest !== undefined) return latest
      const snapshot = await this.artifacts.getVersion(publicId, version)
      if (!snapshot) return null
      const projection = projectArtboard(snapshot.source, version)
      await boardProjections.save(publicId, version, projection)
      return projection?.index ?? null
    })
  }
}
