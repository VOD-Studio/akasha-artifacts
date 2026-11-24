import type { ElementRef } from '@akasha/protocol'
import type { CanvasDocument } from '../../entities/artifact'

interface BlockPlacement {
  boardId: string
  blockId: string
}

/**
 * 返回一个函数，为只带 `blockId` 的历史反馈补上画板归属。
 *
 * @returns 元素已带 `boardId` 或没有 `blockId` 时原样返回；否则按画板源码里的
 * `data-ak-block` 找到所属画板并补上 `boardId`。同一个块标识出现在多个画板时不补。
 */
export function createCanvasElementResolver(canvas: CanvasDocument) {
  let legacyBoards: Map<string, BlockPlacement | null> | undefined
  return (element: ElementRef): ElementRef => {
    if (element.boardId || !element.blockId) return element
    legacyBoards ??= indexLegacyBlocks(canvas)
    const placement = legacyBoards.get(element.blockId)
    return placement ? { ...element, ...placement } : element
  }
}

function indexLegacyBlocks(canvas: CanvasDocument) {
  const placements = new Map<string, BlockPlacement | null>()
  const add = (key: string, boardId: string, blockId = key) => {
    const previous = placements.get(key)
    if (previous === undefined) placements.set(key, { boardId, blockId })
    else if (previous?.boardId !== boardId || previous.blockId !== blockId)
      placements.set(key, null)
  }
  const seen = new Set<string>()
  // 只在未带 boardId 的历史反馈上读取惰性模板；不把源码节点插入工作台 DOM。
  const template = document.createElement('template')
  for (const page of canvas.pages) {
    for (const board of page.boards) {
      if (!board.scoped || seen.has(board.id)) continue
      seen.add(board.id)
      add(board.id, board.id)
      if (board.legacyBlockId) add(board.legacyBlockId, board.id, board.id)
      template.innerHTML = board.source
      for (const node of template.content.querySelectorAll('[data-ak-block]')) {
        const id = node.getAttribute('data-ak-block')?.trim()
        if (id) add(id, board.id)
      }
    }
  }
  return placements
}
