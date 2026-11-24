import { visitHtmlBlockIds } from '@akasha/jsx-source'
import {
  type ArtboardIndex,
  type ArtboardProjection,
  type Artifact,
  type Feedback,
  isAnnotationKind,
  projectArtboard,
  type WorkspaceVersion,
} from '@akasha/protocol'
import type { ArtifactRepository } from '../domain/ports.js'
import { KeyedAsyncLock } from './keyed-lock.js'

interface LegacyBlockPlacement {
  boardId: string
  blockId: string
}

type LegacyBlockPlacements = ReadonlyMap<string, LegacyBlockPlacement | null>

const MAX_CACHED_LEGACY_VERSIONS = 16

function indexLegacyBlocks(projection: ArtboardProjection | null): LegacyBlockPlacements {
  const placements = new Map<string, LegacyBlockPlacement | null>()
  if (!projection) return placements
  const add = (key: string, boardId: string, blockId = key) => {
    const previous = placements.get(key)
    if (previous === undefined) placements.set(key, { boardId, blockId })
    else if (previous && (previous.boardId !== boardId || previous.blockId !== blockId))
      placements.set(key, null)
  }
  for (const { id, legacyId } of projection.index.boards) {
    add(id, id)
    if (legacyId) add(legacyId, id, id)
  }
  for (const { id, html } of projection.contents) {
    if (html) visitHtmlBlockIds(html, (blockId) => add(blockId, id))
  }
  return placements
}

/** 必须先由调用方取得有权限读取的活动制品，再按指定版本读取派生数据。 */
export class ArtifactWorkspaceRead {
  private readonly rebuilds = new KeyedAsyncLock()
  private readonly legacyPlacements = new Map<string, Promise<LegacyBlockPlacements>>()

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

  /** 只衍生已通过可见性筛选的批注锚点；不修改反馈，也不回落到头版本。 */
  async resolveLegacyFeedback(artifact: Artifact, items: readonly Feedback[]) {
    if (artifact.type !== 'artboard') return items
    let byVersion: Map<number, LegacyBlockPlacements> | undefined
    let resolved: Feedback[] | undefined
    for (const [index, item] of items.entries()) {
      const { kind, element, version } = item
      if (!element?.blockId || element.boardId || !isAnnotationKind(kind)) continue
      byVersion ??= new Map()
      let placements = byVersion.get(version)
      if (!placements) {
        placements = await this.getLegacyPlacements(artifact, version)
        byVersion.set(version, placements)
      }
      const placement = placements.get(element.blockId)
      if (placement) {
        resolved ??= items.slice()
        resolved[index] = { ...item, element: { ...element, ...placement } }
      }
    }
    return resolved ?? items
  }

  private getLegacyPlacements({ publicId }: Artifact, version: number) {
    const key = `${publicId}:${version}`
    const cache = this.legacyPlacements
    let placements = cache.get(key)
    if (placements) {
      cache.delete(key)
    } else {
      placements = this.artifacts.getVersion(publicId, version).then((snapshot) => {
        return indexLegacyBlocks(snapshot ? projectArtboard(snapshot.source, version) : null)
      })
      void placements.catch(() => {
        if (cache.get(key) === placements) cache.delete(key)
      })
    }
    // 仅缓存不可变版本的归属，不留存整稿。
    cache.set(key, placements)
    if (cache.size > MAX_CACHED_LEGACY_VERSIONS) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return placements
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
