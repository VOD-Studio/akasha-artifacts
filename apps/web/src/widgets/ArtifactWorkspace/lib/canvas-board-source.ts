import {
  ARTBOARD_GEOMETRY_LIMITS,
  ARTIFACT_DEFAULT_VIEWPORT,
  ArtboardAppearanceSchema,
  type ArtboardLayoutGuide,
  ArtboardLayoutGuidesSchema,
  type ArtboardPrintLayout,
  ArtboardPrintLayoutSchema,
  DEFAULT_ARTBOARD_APPEARANCE,
  type DesignLayer,
  type DesignLayerFontWeight,
  DesignLayersSchema,
  type DesignLayerTextAlign,
  readEditableArtboardSource,
} from '@akasha/protocol'
import type { CanvasBounds } from '@/entities/artifact'
import { fitSelection } from './canvas-arrangement'
import { removeCanvasBoards } from './canvas-edit-source'
import { patchHtmlElementGeometry } from './html-element-geometry'

/** 一次画板编辑只产生一个新快照。几何不包含相机状态。 */
export type CanvasBoardEdit =
  | { kind: 'create'; id: string; title: string; pageId: string; bounds?: CanvasBounds }
  | { kind: 'duplicate'; boardId: string; id: string; bounds: CanvasBounds }
  | {
      kind: 'pasteBoards'
      pageId: string
      boards: readonly {
        id: string
        title: string
        bounds: CanvasBounds
        raw: Record<string, unknown>
      }[]
    }
  | { kind: 'delete'; ids: readonly string[] }
  | { kind: 'geometry'; changes: readonly { id: string; bounds: CanvasBounds }[] }
  | {
      kind: 'boardFlip'
      ids: readonly string[]
      bounds: ReadonlyMap<string, CanvasBounds>
      axis: 'horizontal' | 'vertical'
    }
  | {
      kind: 'boardProperties'
      boardId: string
      width: number
      height: number
      background: string
      cornerRadius: number
    }
  | {
      kind: 'printLayout'
      boardId: string
      printLayout: ArtboardPrintLayout
      layoutGuides: ArtboardLayoutGuide[]
    }
  | { kind: 'group'; ids: readonly string[]; layoutGroup: string | null }
  | {
      kind: 'layerGeometry'
      boardId: string
      changes: readonly {
        id: string
        bounds: CanvasBounds
        color?: NonNullable<DesignLayer['color']> | null
      }[]
    }
  | {
      kind: 'layerStyle'
      boardId: string
      layerIds: readonly string[]
      patch: {
        color?: NonNullable<DesignLayer['color']> | null
        fontSize?: number | null
        fontWeight?: DesignLayerFontWeight | null
        textAlign?: DesignLayerTextAlign | null
      }
    }
  | {
      kind: 'layerFlip'
      boardId: string
      layerIds: readonly string[]
      axis: 'horizontal' | 'vertical'
    }
  | { kind: 'layerReorder'; boardId: string; layerId: string; delta: -1 | 1 }
  | { kind: 'layerGroup'; boardId: string; ids: readonly string[]; layoutGroup: string | null }
  | { kind: 'layerCreate'; boardId: string; layer: DesignLayer }
  | { kind: 'layerPaste'; boardId: string; layers: readonly DesignLayer[] }
  | { kind: 'layerDuplicate'; boardId: string; layerId: string; id: string }
  | { kind: 'layerDelete'; boardId: string; layerId: string }
  | { kind: 'layerDeleteMany'; boardId: string; layerIds: readonly string[] }
  | { kind: 'layerText'; boardId: string; layerId: string; text: string }
  | {
      kind: 'htmlElementGeometry'
      boardId: string
      loc: string
      translateDelta?: { dx: number; dy: number }
      width?: number
      height?: number
    }

/** 版本重放用真实源码，而不是可变 DOM 或相机快照。 */
export interface CanvasSourceChange {
  before: string
  after: string
}

function viewport(width: number, height: number) {
  const limit = ARTBOARD_GEOMETRY_LIMITS.viewport
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= limit)) {
    throw new Error(`画板宽高须在 1–${limit} CSS 像素之间`)
  }
  return { width, height }
}

function updateRecord(
  record: Record<string, unknown>,
  key: string,
  fields: Record<string, unknown>,
) {
  const existing = record[key]
  record[key] =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...existing, ...fields }
      : fields
}

function geometry({ x, y, width, height }: CanvasBounds) {
  const { coordinate } = ARTBOARD_GEOMETRY_LIMITS
  if (![x, y].every((value) => Number.isFinite(value) && Math.abs(value) <= coordinate)) {
    throw new Error('画板位置超出画布坐标范围')
  }
  return { position: { x, y }, viewport: viewport(width, height) }
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
        ...(edit.bounds ? geometry(edit.bounds) : {}),
        html: '',
      })
      break
    }
    case 'pasteBoards': {
      if (edit.pageId && !pages.has(edit.pageId)) throw new Error('该页面已不存在')
      if (!edit.boards.length) return { before, after: source }
      for (const entry of edit.boards) {
        if (boards.has(entry.id)) throw new Error('画板标识已存在')
        const copy = {
          ...structuredClone(entry.raw),
          ...geometry(entry.bounds),
          id: entry.id,
          title: entry.title,
        } as Record<string, unknown>
        if (edit.pageId) copy.pageId = edit.pageId
        else delete copy.pageId
        delete copy.legacyId
        delete copy.groupId
        raw.boards.push(copy)
      }
      break
    }
    case 'boardFlip': {
      if (edit.ids.length < 2) return { before, after: source }
      const boxes: Array<{ id: string; box: CanvasBounds }> = []
      for (const id of edit.ids) {
        const box = edit.bounds.get(id)
        if (!box || !boards.has(id)) throw new Error('要翻转的画板已不存在')
        boxes.push({ id, box })
      }
      const fit = fitSelection(boxes.map(({ box }) => box))
      if (!fit) return { before, after: source }
      let changed = false
      for (const { id, box } of boxes) {
        const target = boards.get(id)
        if (!target) continue
        const next: CanvasBounds =
          edit.axis === 'horizontal'
            ? { ...box, x: Math.round(fit.x + fit.width - (box.x - fit.x) - box.width) }
            : { ...box, y: Math.round(fit.y + fit.height - (box.y - fit.y) - box.height) }
        if (next.x !== box.x || next.y !== box.y) {
          changed = true
          Object.assign(target.raw, geometry(next))
        }
      }
      if (!changed) return { before, after: source }
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
    case 'printLayout': {
      const target = boards.get(edit.boardId)
      if (!target) throw new Error('要调整的画板已不存在')
      const layout = ArtboardPrintLayoutSchema.safeParse(edit.printLayout)
      const guides = ArtboardLayoutGuidesSchema.safeParse(edit.layoutGuides)
      if (!layout.success || !guides.success) throw new Error('打印版式或辅助线不符合约束')
      const currentLayout = target.board.printLayout ?? { mode: 'fixed' }
      const currentGuides = target.board.layoutGuides ?? []
      const sameLayout =
        currentLayout.mode === layout.data.mode &&
        (layout.data.mode === 'fixed' ||
          (currentLayout.mode === 'flow' && currentLayout.paper === layout.data.paper))
      const sameGuides =
        currentGuides.length === guides.data.length &&
        currentGuides.every(
          ({ axis, position }, index) =>
            axis === guides.data[index]?.axis && position === guides.data[index]?.position,
        )
      if (sameLayout && sameGuides) return { before: source, after: source }
      if (target.raw.viewport !== undefined && !target.board.viewport)
        throw new Error('请先修正画板视口的宽高')
      if (!sameLayout) target.raw.printLayout = layout.data
      if (!sameGuides) target.raw.layoutGuides = guides.data
      break
    }
    case 'boardProperties': {
      const target = boards.get(edit.boardId)
      if (!target) throw new Error('要调整的画板已不存在')
      const dimensions = viewport(edit.width, edit.height)
      const { background, cornerRadius } = edit
      if (!ArtboardAppearanceSchema.safeParse({ background, cornerRadius }).success)
        throw new Error('画板背景或圆角不符合约束')
      const currentViewport = target.board.viewport ?? ARTIFACT_DEFAULT_VIEWPORT
      const currentBackground =
        target.board.appearance?.background ?? DEFAULT_ARTBOARD_APPEARANCE.background
      const currentRadius =
        target.board.appearance?.cornerRadius ?? DEFAULT_ARTBOARD_APPEARANCE.cornerRadius
      const resize =
        dimensions.width !== currentViewport.width || dimensions.height !== currentViewport.height
      const restyle =
        background.toLowerCase() !== currentBackground.toLowerCase() ||
        cornerRadius !== currentRadius
      if (!resize && !restyle) return { before, after: source }
      if (resize) updateRecord(target.raw, 'viewport', dimensions)
      if (restyle) updateRecord(target.raw, 'appearance', { background, cornerRadius })
      break
    }
    case 'layerText':
    case 'layerCreate':
    case 'layerPaste':
    case 'layerDuplicate':
    case 'layerDelete':
    case 'layerDeleteMany':
    case 'layerReorder': {
      const board = boards.get(edit.boardId)
      if (!board) throw new Error('原生图层所在的画板已变更')
      const layers = (board.raw.designLayers ?? []) as Array<Record<string, unknown>>
      if (edit.kind === 'layerCreate') {
        layers.push(edit.layer)
      } else if (edit.kind === 'layerPaste') {
        if (!edit.layers.length) return { before, after: source }
        layers.push(...edit.layers.map((layer) => structuredClone(layer)))
      } else if (edit.kind === 'layerDeleteMany') {
        const drop = new Set(edit.layerIds)
        const remaining = layers.filter((layer) => !drop.has(String(layer.id)))
        if (remaining.length === layers.length) return { before, after: source }
        layers.length = 0
        layers.push(...remaining)
      } else if (edit.kind === 'layerReorder') {
        const index = layers.findIndex((layer) => layer.id === edit.layerId)
        if (index === -1) throw new Error('图层已不存在')
        const nextIndex = index + edit.delta
        if (nextIndex < 0 || nextIndex >= layers.length) return { before, after: source }
        const [moved] = layers.splice(index, 1)
        if (moved) layers.splice(nextIndex, 0, moved)
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
    case 'htmlElementGeometry': {
      const board = boards.get(edit.boardId)
      if (!board || typeof board.raw.html !== 'string') {
        throw new Error('该画板不支持直接移动或拉伸 HTML 元素')
      }
      const nextHtml = patchHtmlElementGeometry(board.raw.html, edit.loc, edit)
      if (nextHtml === board.raw.html) return { before, after: source }
      board.raw.html = nextHtml
      break
    }
    case 'layerGeometry':
    case 'layerStyle':
    case 'layerFlip':
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
        for (const { id, bounds, color } of edit.changes) {
          const layer = layers.get(id)
          if (!layer) throw new Error('要调整的图层已不存在')
          const { position, viewport } = geometry(bounds)
          Object.assign(layer, position, viewport)
          if (color === null) delete layer.color
          else if (color !== undefined) layer.color = color
        }
      } else if (edit.kind === 'layerStyle') {
        let changed = false
        for (const id of edit.layerIds) {
          const layer = layers.get(id)
          if (!layer) throw new Error('要调整的图层已不存在')
          const isText = layer.kind === 'text' || layer.kind === 'note'
          if (edit.patch.color !== undefined) {
            if (edit.patch.color === null) {
              if ('color' in layer) {
                delete layer.color
                changed = true
              }
            } else if (layer.color !== edit.patch.color) {
              layer.color = edit.patch.color
              changed = true
            }
          }
          if (isText && edit.patch.fontSize !== undefined) {
            if (edit.patch.fontSize === null) {
              if ('fontSize' in layer) {
                delete layer.fontSize
                changed = true
              }
            } else if (layer.fontSize !== edit.patch.fontSize) {
              layer.fontSize = edit.patch.fontSize
              changed = true
            }
          }
          if (isText && edit.patch.fontWeight !== undefined) {
            if (edit.patch.fontWeight === null) {
              if ('fontWeight' in layer) {
                delete layer.fontWeight
                changed = true
              }
            } else if (layer.fontWeight !== edit.patch.fontWeight) {
              layer.fontWeight = edit.patch.fontWeight
              changed = true
            }
          }
          if (isText && edit.patch.textAlign !== undefined) {
            if (edit.patch.textAlign === null) {
              if ('textAlign' in layer) {
                delete layer.textAlign
                changed = true
              }
            } else if (layer.textAlign !== edit.patch.textAlign) {
              layer.textAlign = edit.patch.textAlign
              changed = true
            }
          }
        }
        if (!changed) return { before, after: source }
      } else if (edit.kind === 'layerFlip') {
        const targets = edit.layerIds.map((id) => {
          const layer = layers.get(id)
          const parsed = board.board.designLayers?.find((item) => item.id === id)
          if (!layer || !parsed) throw new Error('要翻转的图层已不存在')
          return { layer, parsed }
        })
        if (!targets.length) return { before, after: source }
        const fit = targets.length > 1 ? fitSelection(targets.map(({ parsed }) => parsed)) : null
        for (const { layer, parsed } of targets) {
          const flag = edit.axis === 'horizontal' ? 'flipX' : 'flipY'
          if (layer[flag]) delete layer[flag]
          else layer[flag] = true
          if (fit) {
            if (edit.axis === 'horizontal') {
              layer.x = Math.round(fit.x + fit.width - (parsed.x - fit.x) - parsed.width)
            } else {
              layer.y = Math.round(fit.y + fit.height - (parsed.y - fit.y) - parsed.height)
            }
          }
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
