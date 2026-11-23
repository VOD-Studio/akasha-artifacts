import type { CanvasBoard } from './canvas-model'

/** 画布坐标系里的点，单位 CSS 像素。 */
export interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

type Bounds = Point & Size

/**
 * 画布相机：描述画布相对视口的平移与缩放。
 *
 * @remarks 换算关系：视口坐标 = 相机偏移 + 画布坐标 × `scale`。
 */
export interface Camera extends Point {
  /** 缩放倍率，限制在 0.001 到 4 之间。 */
  scale: number
  /** 最近一次适配的范围；手动平移或缩放后清空。 */
  fit: 'page' | 'board' | null
}

/** 初始相机：未平移、未缩放、未适配。 */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1, fit: null }
// 画板之间以及画板与页面边缘之间的间距，单位 CSS 像素
const GUTTER = 100
const MIN_ZOOM = 0.001
const MAX_ZOOM = 4

/**
 * 按每行 `columns` 个排布画板，返回每块画板在画布上的位置与整页的包围盒。
 *
 * @remarks 行高取该行最高的画板，画板之间留固定间距。
 */
export function layoutBoards(boards: readonly CanvasBoard[], columns: number) {
  const bounds = new Map<string, Bounds>()
  const count = Math.max(1, columns)
  let width = 0
  let y = 0
  for (let start = 0; start < boards.length; start += count) {
    let x = 0
    let height = 0
    for (let index = start, end = Math.min(start + count, boards.length); index < end; index += 1) {
      const board = boards[index]
      if (!board) continue
      bounds.set(board.id, { x, y, width: board.width, height: board.height })
      width = Math.max(width, x + board.width)
      height = Math.max(height, board.height)
      x += board.width + GUTTER
    }
    y += height + GUTTER
  }
  return { bounds, page: { x: 0, y: 0, width, height: Math.max(0, y - GUTTER) } }
}

/**
 * 让相机把 `bounds` 完整放进 `viewport`，不放大到 1 倍以上。
 *
 * @returns 带 `fit` 标记的相机，标记表示这次适配的范围。
 */
export function fitCamera(bounds: Bounds, viewport: Size, fit: Camera['fit']): Camera {
  const widthScale = Math.max(1, viewport.width - 32) / Math.max(1, bounds.width)
  const heightScale = Math.max(1, viewport.height - 136) / Math.max(1, bounds.height)
  const scale = Math.max(MIN_ZOOM, Math.min(1, widthScale, heightScale))
  return {
    scale,
    fit,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  }
}

/** 以 `anchor`（缩放前）与 `next`（缩放后）为同一锚点缩放，并清除适配标记。 */
export function zoomCamera(camera: Camera, factor: number, anchor: Point, next = anchor): Camera {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.scale * factor))
  if (scale === camera.scale && anchor.x === next.x && anchor.y === next.y) return camera
  const ratio = scale / camera.scale
  return {
    scale,
    fit: null,
    x: next.x - (anchor.x - camera.x) * ratio,
    y: next.y - (anchor.y - camera.y) * ratio,
  }
}
