import {
  ARTBOARD_GEOMETRY_LIMITS,
  type DesignLayer,
  readEditableArtboardSource,
} from '@akasha/protocol'
import type { CanvasBounds } from '@/entities/artifact'

/** 画布内部剪贴板条目；复制的是数据快照而非 DOM 节点。 */
export type CanvasClipboardEntry =
  | {
      kind: 'layers'
      sourceBoardId: string
      layers: readonly DesignLayer[]
      pasteCount: number
    }
  | {
      kind: 'boards'
      sourcePageId: string
      boards: readonly {
        title: string
        bounds: CanvasBounds
        layoutGroup?: string
        raw: Record<string, unknown>
      }[]
      pasteCount: number
    }

const LAYER_PASTE_OFFSET = 16
const BOARD_PASTE_OFFSET = 48

function clampCoordinate(value: number): number {
  const limit = ARTBOARD_GEOMETRY_LIMITS.coordinate
  return Math.min(limit, Math.max(-limit, Math.round(value)))
}

/** 按基准版本源码提取待复制画板的原始声明，保留未知字段与原生图层。 */
export function snapshotBoardsForClipboard(
  source: string,
  version: number,
  pageId: string,
  boardIds: readonly string[],
  boundsById: ReadonlyMap<string, CanvasBounds>,
): Extract<CanvasClipboardEntry, { kind: 'boards' }> | null {
  const editable = readEditableArtboardSource(source, version)
  const items: Array<{
    title: string
    bounds: CanvasBounds
    layoutGroup?: string
    raw: Record<string, unknown>
  }> = []
  for (const id of boardIds) {
    const entry = editable.boards.get(id)
    const bounds = boundsById.get(id)
    if (!entry || !bounds) continue
    const clone = structuredClone(entry.raw)
    delete clone.legacyId
    delete clone.groupId
    items.push({
      title: entry.board.title,
      bounds: { ...bounds },
      layoutGroup: entry.board.layoutGroup,
      raw: clone,
    })
  }
  if (!items.length) return null
  return { kind: 'boards', sourcePageId: pageId, boards: items, pasteCount: 0 }
}

/** 为粘贴到目标画板的图层分配新标识，同板粘贴时平移位置并独立重映射分组。 */
export function materializePastedLayers(
  entry: Extract<CanvasClipboardEntry, { kind: 'layers' }>,
  targetBoardId: string,
  nextId: () => string = () => crypto.randomUUID(),
): DesignLayer[] {
  const offset =
    entry.sourceBoardId === targetBoardId ? LAYER_PASTE_OFFSET * (entry.pasteCount + 1) : 0
  const groupMap = new Map<string, string>()
  return entry.layers.map((layer) => {
    let layoutGroup: string | undefined
    if (layer.layoutGroup) {
      layoutGroup = groupMap.get(layer.layoutGroup)
      if (!layoutGroup) {
        layoutGroup = nextId()
        groupMap.set(layer.layoutGroup, layoutGroup)
      }
    }
    return {
      ...structuredClone(layer),
      id: nextId(),
      x: clampCoordinate(layer.x + offset),
      y: clampCoordinate(layer.y + offset),
      ...(layoutGroup ? { layoutGroup } : { layoutGroup: undefined }),
    }
  })
}

/** 为粘贴到目标页面的画板分配新标识与偏移位置，保持原组内相对关系。 */
export function materializePastedBoards(
  entry: Extract<CanvasClipboardEntry, { kind: 'boards' }>,
  targetPageId: string,
  nextId: () => string = () => crypto.randomUUID(),
): Array<{ id: string; title: string; bounds: CanvasBounds; raw: Record<string, unknown> }> {
  const offset =
    entry.sourcePageId === targetPageId ? BOARD_PASTE_OFFSET * (entry.pasteCount + 1) : 0
  const groupMap = new Map<string, string>()
  return entry.boards.map((board) => {
    const id = nextId()
    const raw = structuredClone(board.raw)
    let layoutGroup: string | undefined
    if (board.layoutGroup && entry.boards.length > 1) {
      layoutGroup = groupMap.get(board.layoutGroup)
      if (!layoutGroup) {
        layoutGroup = nextId()
        groupMap.set(board.layoutGroup, layoutGroup)
      }
    }
    if (layoutGroup) raw.layoutGroup = layoutGroup
    else delete raw.layoutGroup
    return {
      id,
      title: `${board.title} 副本`,
      bounds: {
        ...board.bounds,
        x: clampCoordinate(board.bounds.x + offset),
        y: clampCoordinate(board.bounds.y + offset),
      },
      raw,
    }
  })
}
