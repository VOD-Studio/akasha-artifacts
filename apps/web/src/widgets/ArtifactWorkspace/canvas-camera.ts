import type { CanvasBoard } from './canvas-model'

export interface Point {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

type Bounds = Point & Size

export interface Camera extends Point {
  scale: number
  fit: 'page' | 'board' | null
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1, fit: null }
const GUTTER = 100
const MIN_ZOOM = 0.001
const MAX_ZOOM = 4

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
