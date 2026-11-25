import type { VersionSummary } from '@akasha/protocol'
import type { CanvasDocument, LoadedCanvasBoard } from '@/entities/artifact'
import { type CanvasBounds, layoutBoards } from './canvas-camera'

/** 同一作品固定版本、同一页面的画板选区；空字符串指合成页面。 */
export interface CanvasExportSelection {
  artifactId: string
  version: number
  pageId: string
  boardIds: readonly string[]
}

/**
 * 按固定页面的画布坐标从上到下、从左到右返回所选画板，同坐标沿用页面定义顺序。
 *
 * @throws 选区为空、与作品固定版本不符，或该页不含全部所选画板时拒绝导出。
 */
export function resolveSelectedExportBoards(
  document: CanvasDocument<LoadedCanvasBoard>,
  version: Pick<VersionSummary, 'artifactId' | 'version'>,
  selection: CanvasExportSelection,
): LoadedCanvasBoard[] {
  if (selection.artifactId !== version.artifactId || selection.version !== version.version) {
    throw new Error('所选画板不属于此作品的固定版本')
  }
  if (selection.boardIds.length === 0) throw new Error('未选择画板')
  const page = document.pages.find(({ id }) => id === selection.pageId)
  if (!page) throw new Error('固定版本中没有选区所在的页面')

  const ids = new Set(selection.boardIds)
  const selected = page.boards.filter((board) => ids.has(board.id))
  if (selected.length !== ids.size) throw new Error('当前页面不包含全部所选画板')

  let bounds: Map<string, CanvasBounds> | undefined
  const positionOf = (board: LoadedCanvasBoard) => {
    if (board.position) return board.position
    bounds ??= layoutBoards(page.boards, document.columns).bounds
    const position = bounds.get(board.id)
    if (!position) throw new Error('无法确定所选画板在页面中的位置')
    return position
  }
  return selected.sort((a, b) => {
    const start = positionOf(a)
    const end = positionOf(b)
    return start.y - end.y || start.x - end.x
  })
}
