import type { CanvasLayer, DesignLayerFontWeight, DesignLayerTextAlign } from '@akasha/protocol'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { groupMembers } from './canvas-arrangement'

/** 返回画板图层树中的第一个顶层图层；无图层时返回 `undefined`。 */
export function firstRootLayer(layers: readonly CanvasLayer[]): CanvasLayer | undefined {
  const ids = new Set(layers.map((layer) => layer.id))
  return layers.find((layer) => !layer.parentId || !ids.has(layer.parentId))
}

/** 返回指定图层的父图层；位于顶层时返回 `undefined`。 */
export function parentLayer(layers: readonly CanvasLayer[], id: string): CanvasLayer | undefined {
  const current = layers.find((layer) => layer.id === id)
  if (!current?.parentId) return undefined
  return layers.find((layer) => layer.id === current.parentId)
}

/** 返回指定图层的第一个子图层；叶子图层返回 `undefined`。 */
export function firstChildLayer(
  layers: readonly CanvasLayer[],
  id: string,
): CanvasLayer | undefined {
  return layers.find((layer) => layer.parentId === id)
}

/** 在同一父级下按方向循环遍历兄弟图层；仅有一个兄弟时返回自身。 */
export function nextSiblingLayer(
  layers: readonly CanvasLayer[],
  id: string,
  direction: 1 | -1,
): CanvasLayer | undefined {
  const ids = new Set(layers.map((layer) => layer.id))
  const current = layers.find((layer) => layer.id === id)
  if (!current) return firstRootLayer(layers)
  const parentKey = current.parentId && ids.has(current.parentId) ? current.parentId : ''
  const siblings = layers.filter((layer) => {
    const key = layer.parentId && ids.has(layer.parentId) ? layer.parentId : ''
    return key === parentKey
  })
  if (!siblings.length) return undefined
  const index = siblings.findIndex((layer) => layer.id === id)
  if (index === -1) return siblings[0]
  return siblings[(index + direction + siblings.length) % siblings.length]
}

function intersectionArea(a: CanvasBounds, b: CanvasBounds): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= left || bottom <= top) return 0
  return (right - left) * (bottom - top)
}

/** 返回与画布框选区域相交的画板 ID，并展开命中的布局分组。 */
export function boardsIntersectingRect(
  boards: readonly CanvasBoard[],
  boundsById: ReadonlyMap<string, CanvasBounds>,
  rect: CanvasBounds,
): string[] {
  const matched = new Set<string>()
  for (const board of boards) {
    const bounds = boundsById.get(board.id)
    if (!bounds || intersectionArea(bounds, rect) <= 0) continue
    for (const member of groupMembers(boards, board.id)) matched.add(member)
  }
  return boards.filter((board) => matched.has(board.id)).map((board) => board.id)
}

/**
 * 确定跨画板边界或从空白处绘制的原生图层的归属画板，并换算为板内坐标。
 *
 * @remarks 优先归属起笔所在的画板（只要图形仍与之相交）；否则取相交面积最大的画板。
 * 与所有画板均无交集时返回 `null`，避免在空白画布生成游离数据。
 */
export function resolveLayerOwnerBoard(
  boards: readonly CanvasBoard[],
  boundsById: ReadonlyMap<string, CanvasBounds>,
  canvasRect: CanvasBounds,
  preferredBoardId?: string,
): { board: CanvasBoard; localBounds: CanvasBounds } | null {
  let chosen: { board: CanvasBoard; bounds: CanvasBounds } | null = null
  if (preferredBoardId) {
    const preferred = boards.find((board) => board.id === preferredBoardId)
    const preferredBounds = preferred && boundsById.get(preferred.id)
    if (preferred && preferredBounds && intersectionArea(preferredBounds, canvasRect) > 0) {
      chosen = { board: preferred, bounds: preferredBounds }
    }
  }
  if (!chosen) {
    let bestArea = 0
    for (const board of boards) {
      const bounds = boundsById.get(board.id)
      if (!bounds) continue
      const area = intersectionArea(bounds, canvasRect)
      if (area >= bestArea && area > 0) {
        bestArea = area
        chosen = { board, bounds }
      }
    }
  }
  if (!chosen) return null
  return {
    board: chosen.board,
    localBounds: {
      x: Math.round(canvasRect.x - chosen.bounds.x),
      y: Math.round(canvasRect.y - chosen.bounds.y),
      width: Math.max(1, Math.round(canvasRect.width)),
      height: Math.max(1, Math.round(canvasRect.height)),
    },
  }
}

const FONT_SIZE_CLASS_MAP: Readonly<Record<number, string>> = {
  12: 'text-xs',
  14: 'text-sm',
  16: 'text-base',
  20: 'text-xl',
  24: 'text-2xl',
  32: 'text-[32px]',
}

const FONT_WEIGHT_CLASS_MAP: Readonly<Record<DesignLayerFontWeight, string>> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
}

const TEXT_ALIGN_CLASS_MAP: Readonly<Record<DesignLayerTextAlign, string>> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

const TEXT_SIZE_TOKEN = /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[\d+(?:\.\d+)?(?:px|rem|em)\])$/
const FONT_WEIGHT_TOKEN =
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/
const TEXT_ALIGN_TOKEN = /^text-(?:left|center|right|justify|start|end)$/
const TEXT_COLOR_TOKEN =
  /^text-(?:inherit|current|transparent|black|white|ink(?:-muted)?|primary|secondary|accent|destructive|\[#[\da-f]{3,8}\]|[a-z]+-(?:50|[1-9]00|950))$/i

/** 替换静态 HTML/React 元素上冲突的文字排版、对齐或颜色 Tailwind 类名，保留其余类。 */
export function updateTailwindTextClasses(
  className: string,
  patch: {
    fontSize?: number
    fontWeight?: DesignLayerFontWeight
    textAlign?: DesignLayerTextAlign
    colorHex?: string
  },
): string {
  const tokens = className.trim() ? className.trim().split(/\s+/) : []
  const filtered = tokens.filter((token) => {
    if (patch.fontSize !== undefined && TEXT_SIZE_TOKEN.test(token)) return false
    if (patch.fontWeight !== undefined && FONT_WEIGHT_TOKEN.test(token)) return false
    if (patch.textAlign !== undefined && TEXT_ALIGN_TOKEN.test(token)) return false
    if (patch.colorHex !== undefined && TEXT_COLOR_TOKEN.test(token)) return false
    return true
  })
  if (patch.fontSize !== undefined) {
    filtered.push(FONT_SIZE_CLASS_MAP[patch.fontSize] ?? `text-[${patch.fontSize}px]`)
  }
  if (patch.fontWeight !== undefined) {
    filtered.push(FONT_WEIGHT_CLASS_MAP[patch.fontWeight])
  }
  if (patch.textAlign !== undefined) {
    filtered.push(TEXT_ALIGN_CLASS_MAP[patch.textAlign])
  }
  if (patch.colorHex !== undefined) {
    filtered.push(`text-[${patch.colorHex.toLowerCase()}]`)
  }
  return filtered.join(' ')
}
