import {
  ARTBOARD_GEOMETRY_LIMITS,
  type DesignLayer,
  DesignLayersSchema,
  readEditableArtboardSource,
} from '@akasha/protocol'
import type { CanvasBounds } from './canvas-camera'
import { removeCanvasBoards } from './canvas-edit-source'

/** 一次画板编辑只产生一个新快照。几何不包含相机状态。 */
export type CanvasBoardEdit =
  | { kind: 'create'; id: string; title: string; pageId: string }
  | { kind: 'duplicate'; boardId: string; id: string; bounds: CanvasBounds }
  | { kind: 'delete'; ids: readonly string[] }
  | { kind: 'geometry'; changes: readonly { id: string; bounds: CanvasBounds }[] }
  | { kind: 'group'; ids: readonly string[]; layoutGroup: string | null }
  | {
      kind: 'layerGeometry'
      boardId: string
      changes: readonly { id: string; bounds: CanvasBounds }[]
    }
  | { kind: 'layerGroup'; boardId: string; ids: readonly string[]; layoutGroup: string | null }
  | { kind: 'layerCreate'; boardId: string; layer: DesignLayer }
  | { kind: 'layerDuplicate'; boardId: string; layerId: string; id: string }
  | { kind: 'layerDelete'; boardId: string; layerId: string }
  | { kind: 'layerText'; boardId: string; layerId: string; text: string }

/** 版本重放用真实源码，而不是可变 DOM 或相机快照。 */
export interface CanvasSourceChange {
  before: string
  after: string
}

function geometry({ x, y, width, height }: CanvasBounds) {
  const { coordinate, viewport } = ARTBOARD_GEOMETRY_LIMITS
  if (![x, y].every((value) => Number.isFinite(value) && Math.abs(value) <= coordinate)) {
    throw new Error('画板位置超出画布坐标范围')
  }
  if (
    ![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= viewport)
  ) {
    throw new Error(`画板宽高须在 1–${viewport} CSS 像素之间`)
  }
  return { position: { x, y }, viewport: { width, height } }
}

/** 应用已完成的画板操作，保留无关字段、旧定位和版本内的流程引用。 */
export function editCanvasBoards(
  source: string,
  version: number,
  edit: CanvasBoardEdit,
): CanvasSourceChange {
  const draft = readEditableArtboardSource(source, version)
  const { raw, boards, pages } = draft
  const before = draft.stabilized ? JSON.stringify(raw, null, 2) : source
  switch (edit.kind) {
    case 'create': {
      if (boards.has(edit.id)) throw new Error('画板标识已存在')
      if (edit.pageId && !pages.has(edit.pageId)) throw new Error('该页面已不存在')
      raw.boards.push({
        id: edit.id,
        title: edit.title,
        ...(edit.pageId ? { pageId: edit.pageId } : {}),
        html: '',
      })
      break
    }
    case 'duplicate': {
      if (boards.has(edit.id)) throw new Error('画板标识已存在')
      const original = boards.get(edit.boardId)
      if (!original) throw new Error('要复制的画板已不存在')
      const copy = {
        ...original.raw,
        ...geometry(edit.bounds),
        id: edit.id,
        title: `${original.board.title} 副本`,
      } as Record<string, unknown>
      delete copy.legacyId
      delete copy.groupId
      delete copy.layoutGroup
      raw.boards.push(copy)
      if (Array.isArray(raw.flows)) {
        raw.flows.push(
          ...raw.flows.flatMap((flow: unknown) =>
            flow &&
            typeof flow === 'object' &&
            !Array.isArray(flow) &&
            'from' in flow &&
            typeof flow.from === 'string' &&
            flow.from.trim() === edit.boardId
              ? [{ ...flow, from: edit.id }]
              : [],
          ),
        )
      }
      break
    }
    case 'delete':
      removeCanvasBoards(draft, new Set(edit.ids))
      break
    case 'group':
      for (const id of edit.ids) {
        const target = boards.get(id)
        if (!target) throw new Error('该分组包含已移除的画板')
        if (edit.layoutGroup) target.raw.layoutGroup = edit.layoutGroup
        else delete target.raw.layoutGroup
      }
      break
    case 'geometry':
      for (const { id, bounds } of edit.changes) {
        const target = boards.get(id)
        if (!target) throw new Error('要调整的画板已不存在')
        Object.assign(target.raw, geometry(bounds))
      }
      break
    case 'layerText':
    case 'layerCreate':
    case 'layerDuplicate':
    case 'layerDelete': {
      const board = boards.get(edit.boardId)
      if (!board) throw new Error('原生图层所在的画板已变更')
      const layers = (board.raw.designLayers ?? []) as Array<Record<string, unknown>>
      if (edit.kind === 'layerCreate') {
        layers.push(edit.layer)
      } else {
        const index = layers.findIndex((layer) => layer.id === edit.layerId)
        if (index === -1) throw new Error('图层已不存在')
        if (edit.kind === 'layerDelete') layers.splice(index, 1)
        else if (edit.kind === 'layerText') {
          const layer = layers[index]
          if (layer.kind !== 'text' && layer.kind !== 'note')
            throw new Error('该图层没有可编辑的文字')
          if (layer.text === edit.text) return { before, after: source }
          layer.text = edit.text
        } else {
          const original = board.board.designLayers?.[index]
          if (!original) throw new Error('图层已不存在')
          const copy = {
            ...layers[index],
            id: edit.id,
            x: Math.min(ARTBOARD_GEOMETRY_LIMITS.coordinate, original.x + 16),
            y: Math.min(ARTBOARD_GEOMETRY_LIMITS.coordinate, original.y + 16),
          } as Record<string, unknown>
          delete copy.layoutGroup
          layers.push(copy)
        }
      }
      if (!DesignLayersSchema.safeParse(layers).success)
        throw new Error('画板最多可容纳 96 个图层，标识必须唯一')
      board.raw.designLayers = layers
      break
    }
    case 'layerGeometry':
    case 'layerGroup': {
      const board = boards.get(edit.boardId)
      if (!board || !Array.isArray(board.raw.designLayers))
        throw new Error('原生图层所在的画板已变更')
      const layers = new Map<string, Record<string, unknown>>(
        (board.raw.designLayers as Array<Record<string, unknown>>).map((layer) => [
          String(layer.id),
          layer,
        ]),
      )
      if (edit.kind === 'layerGeometry') {
        for (const { id, bounds } of edit.changes) {
          const layer = layers.get(id)
          if (!layer) throw new Error('要调整的图层已不存在')
          const { position, viewport } = geometry(bounds)
          Object.assign(layer, position, viewport)
        }
      } else {
        for (const id of edit.ids) {
          const layer = layers.get(id)
          if (!layer) throw new Error('该分组中的图层已不存在')
          if (edit.layoutGroup) layer.layoutGroup = edit.layoutGroup
          else delete layer.layoutGroup
        }
      }
      if (!DesignLayersSchema.safeParse(board.raw.designLayers).success) {
        throw new Error('图层变更不符合画板的设计数据约束')
      }
      break
    }
  }
  return { before, after: JSON.stringify(raw, null, 2) }
}
