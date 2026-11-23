import { ARTBOARD_GEOMETRY_LIMITS } from '@akasha/protocol'
import type { CanvasBounds } from './canvas-camera'
import { readEditableCanvasSource, removeCanvasBoards } from './canvas-edit-source'

/** 一次画板编辑只产生一个新快照。几何不包含相机状态。 */
export type CanvasBoardEdit =
  | { kind: 'create'; id: string; title: string; pageId: string }
  | { kind: 'duplicate'; boardId: string; id: string; bounds: CanvasBounds }
  | { kind: 'delete'; ids: readonly string[] }
  | { kind: 'geometry'; changes: readonly { id: string; bounds: CanvasBounds }[] }

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
export function editCanvasBoards(source: string, version: number, edit: CanvasBoardEdit): string {
  const draft = readEditableCanvasSource(source, version)
  const { raw, boards, pages } = draft
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
    case 'geometry':
      for (const { id, bounds } of edit.changes) {
        const target = boards.get(id)
        if (!target) throw new Error('要调整的画板已不存在')
        Object.assign(target.raw, geometry(bounds))
      }
      break
  }
  return JSON.stringify(raw, null, 2)
}
