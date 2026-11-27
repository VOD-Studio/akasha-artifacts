import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import type { Camera } from './canvas-camera'

export const DETAIL_SCALE = 0.22
export const MAX_DETAIL_BOARDS = 24
export const MAX_ANIMATED_BOARDS = 6
const HEADER_PX = 36

interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

interface Item {
  board: CanvasBoard
  area: Area
  order: number
}

type Node = { area: Area } & ({ items: Item[] } | { children: [Node, Node] })

type Size = Pick<CanvasBounds, 'width' | 'height'>

function areaOf({ x, y, width, height }: CanvasBounds): Area {
  return { left: x, top: y, right: x + width, bottom: y + height }
}

function intersects(a: Area, b: Area) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function tree(items: Item[]): Node {
  const area = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const item of items) {
    const b = item.area
    area.left = Math.min(area.left, b.left)
    area.top = Math.min(area.top, b.top)
    area.right = Math.max(area.right, b.right)
    area.bottom = Math.max(area.bottom, b.bottom)
  }
  if (items.length <= 12) return { area, items }
  const horizontal = area.right - area.left >= area.bottom - area.top
  const [start, end] = horizontal ? (['left', 'right'] as const) : (['top', 'bottom'] as const)
  items.sort((a, b) => a.area[start] + a.area[end] - b.area[start] - b.area[end])
  const middle = items.length >> 1
  return { area, children: [tree(items.slice(0, middle)), tree(items.slice(middle))] }
}

/** 仅在页面几何变化时重建；移动相机不扫描屏外画板。 */
export function indexViewportBoards(
  boards: readonly CanvasBoard[],
  bounds: ReadonlyMap<string, CanvasBounds>,
) {
  const byId = new Map<string, Item>()
  for (const [order, board] of boards.entries()) {
    const box = bounds.get(board.id)
    if (box) byId.set(board.id, { board, order, area: areaOf(box) })
  }
  return { byId, root: tree(Array.from(byId.values())) }
}

function visit(
  node: Node,
  area: Area,
  hits: Map<string, Item>,
  moved?: ReadonlyMap<string, CanvasBounds>,
) {
  if (!intersects(node.area, area)) return
  if ('children' in node) {
    visit(node.children[0], area, hits, moved)
    visit(node.children[1], area, hits, moved)
  } else {
    for (const item of node.items) {
      if (!moved?.has(item.board.id) && intersects(item.area, area)) hits.set(item.board.id, item)
    }
  }
}

/** 轮廓按原绘制顺序排列，正文按选中、可见面积和中心距离排队。 */
export function planViewport(
  index: ReturnType<typeof indexViewportBoards>,
  camera: Camera,
  viewport: Size,
  selected: string | null,
  keyboardBoard: string | null,
  moved?: ReadonlyMap<string, CanvasBounds>,
  recent?: ReadonlySet<string>,
) {
  const { scale } = camera
  const clip = {
    left: -camera.x / scale,
    right: (viewport.width - camera.x) / scale,
    top: -camera.y / scale,
    bottom: (viewport.height - camera.y) / scale,
  }
  const header = { ...clip, right: clip.right + 8 / scale, bottom: clip.bottom + HEADER_PX / scale }
  const hits = new Map<string, Item>()
  if (viewport.width && viewport.height) {
    visit(index.root, header, hits, moved)
    for (const [id, box] of moved ?? []) {
      const item = index.byId.get(id)
      const area = areaOf(box)
      if (item && intersects(area, header)) hits.set(id, { ...item, area })
    }
  }
  const centerX = (clip.left + clip.right) / 2
  const centerY = (clip.top + clip.bottom) / 2
  const ranks = []
  for (const [id, { board, area, order }] of hits) {
    if (board.scoped && scale < DETAIL_SCALE && !(camera.fit === 'board' && id === selected))
      continue
    const width = Math.min(area.right, clip.right) - Math.max(area.left, clip.left)
    const height = Math.min(area.bottom, clip.bottom) - Math.max(area.top, clip.top)
    if (width <= 0 || height <= 0) continue
    ranks.push({
      id,
      priority: Number(id === selected || id === keyboardBoard),
      coverage: width * height,
      distance:
        Math.abs((area.left + area.right) / 2 - centerX) +
        Math.abs((area.top + area.bottom) / 2 - centerY),
      order,
    })
  }
  ranks.sort(
    (a, b) =>
      b.priority - a.priority ||
      b.coverage - a.coverage ||
      a.distance - b.distance ||
      a.order - b.order,
  )
  const detail = ranks.slice(0, MAX_DETAIL_BOARDS).map(({ id }) => id)
  const runtime = new Set(detail)
  if (viewport.width && viewport.height && scale >= DETAIL_SCALE && recent?.size) {
    // 只复用已安排过的近邻帧；缓冲区从不触发请求，留优先名额给新进视口的板。
    const leadX = viewport.width / (2 * scale)
    const leadY = viewport.height / (2 * scale)
    const area = {
      left: clip.left - leadX,
      right: clip.right + leadX,
      top: clip.top - leadY,
      bottom: clip.bottom + leadY,
    }
    for (const id of recent) {
      if (runtime.size === MAX_DETAIL_BOARDS) break
      if (runtime.has(id)) continue
      const item = index.byId.get(id)
      const box = moved?.get(id)
      if (!item || !intersects(box ? areaOf(box) : item.area, area)) continue
      runtime.add(id)
      if (!hits.has(id)) hits.set(id, item)
    }
  }
  for (const id of [selected, keyboardBoard]) {
    const retained = id && index.byId.get(id)
    if (retained && !hits.has(retained.board.id)) hits.set(retained.board.id, retained)
  }
  return {
    boards: Array.from(hits.values())
      .sort((a, b) => a.order - b.order)
      .map(({ board }) => board),
    detail,
    runtime,
  }
}
