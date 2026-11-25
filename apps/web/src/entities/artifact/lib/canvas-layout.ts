import type { CanvasBoard } from '../model/canvas'

/** 画板或页面在画布坐标系中的包围盒。 */
export interface CanvasBounds {
  x: number
  y: number
  width: number
  height: number
}

// 画板之间以及画板与页面边缘之间的间距，单位 CSS 像素
const GUTTER = 100

/**
 * 保留显式位置，按每行 `columns` 个为旧画板提供自动位置。
 *
 * @remarks 网格及画板固有尺寸不随相机变化，整页包围盒可以跨越负坐标。
 */
export function layoutBoards(boards: readonly CanvasBoard[], columns: number) {
  const bounds = new Map<string, CanvasBounds>()
  const count = Math.max(1, columns)
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let y = 0
  for (let start = 0; start < boards.length; start += count) {
    let x = 0
    let height = 0
    for (let index = start, end = Math.min(start + count, boards.length); index < end; index += 1) {
      const board = boards[index]
      if (!board) continue
      const position = board.position ?? { x, y }
      bounds.set(board.id, { ...position, width: board.width, height: board.height })
      left = Math.min(left, position.x)
      top = Math.min(top, position.y)
      right = Math.max(right, position.x + board.width)
      bottom = Math.max(bottom, position.y + board.height)
      height = Math.max(height, board.height)
      x += board.width + GUTTER
    }
    y += height + GUTTER
  }
  const page = bounds.size
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : { x: 0, y: 0, width: 0, height: 0 }
  return { bounds, page }
}
