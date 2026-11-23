import {
  type Artifact,
  type ArtifactSharedAccess,
  type ArtifactShareEntry,
  canvasIds,
  type Feedback,
  parseArtboard,
  STANDALONE_BOARD_ID,
  type Version,
} from '@akasha/protocol'
import { fixedShareVersion, type HubShareClaim } from './hub-auth.js'

export function canEditSharedArtifact(share: HubShareClaim) {
  return share.role === 'edit' && share.entry.kind === 'artifact'
}

export function visibleSharedDiscussion(item: Feedback, share: HubShareClaim) {
  const version = fixedShareVersion(share)
  return (
    !item.draft &&
    item.kind === 'comment' &&
    item.audience !== 'agent' &&
    (version === undefined || item.version === version)
  )
}

export function sharedArtifactDetail(
  artifact: Artifact,
  version: Readonly<Version>,
  share: HubShareClaim,
) {
  const fixed = fixedShareVersion(share)
  const access: ArtifactSharedAccess = {
    role: share.role,
    version: fixed,
    expiresAt: new Date(share.exp * 1000).toISOString(),
  }
  return {
    artifact:
      fixed === undefined
        ? artifact
        : {
            ...artifact,
            title: version.title,
            headVersion: fixed,
            updatedAt: version.createdAt,
          },
    version,
    access,
    // 运行状态和内部评审不随设计链接分发。
    state: { artifactId: artifact.publicId, seq: 0, snapshot: {}, updatedAt: version.createdAt },
    rounds: [],
  }
}

/** 试玩目标以固定快照的真实页面和画板定位，不信任访问方传入的链接片段。 */
export function matchesShareBoard(
  artifact: Artifact,
  version: Readonly<Version>,
  entry: Extract<ArtifactShareEntry, { kind: 'play' }>,
) {
  const { pageId, boardId } = entry
  if (artifact.type === 'html' || artifact.type === 'react') {
    return pageId === '' && boardId === STANDALONE_BOARD_ID
  }
  if (artifact.type !== 'artboard') return false
  const parsed = parseArtboard(version.source)
  if (!parsed.ok) return false
  const { pages, boards } = parsed.data
  const pageIds = canvasIds(pages, 'page', version.version)
  const boardIds = canvasIds(boards, 'board', version.version)
  const target = boards.find((board) => boardIds.get(board.id) === boardId)
  if (!target) return false
  if (pageId) {
    const page = pages.findLast((item) => pageIds.get(item.id) === pageId)
    return Boolean(
      page && (target.pageId ? target.pageId === page.id : page.includeSharedBoards !== false),
    )
  }
  if (target.pageId) return !pageIds.has(target.pageId)
  return (
    !pages.some((page) => page.includeSharedBoards !== false) ||
    boards.some((board) => board.pageId && !pageIds.has(board.pageId))
  )
}
