import { z } from 'zod'
import type { ArtboardBoard } from './artboard.js'
import { type EditableArtboardSource, readEditableArtboardSource } from './artboard-edit.js'
import {
  type ArtboardTweak,
  type ArtboardTweakValues,
  ArtboardTweakValuesSchema,
  acceptsArtboardTweakValue,
} from './artboard-tweaks.js'

const changedValues = ArtboardTweakValuesSchema.refine((values) => Object.keys(values).length > 0)
const boardIdSchema = z.string().min(1)

/** 源画板不隐式加入目标；每个目标只能选择一次。 */
export const ArtboardTweakApplicationSchema = z.strictObject({
  boardId: boardIdSchema,
  targetIds: z
    .array(boardIdSchema)
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length),
  /** 仅传相对于源画板快照默认值有变化的参数。 */
  values: changedValues,
})
export type ArtboardTweakApplication = z.infer<typeof ArtboardTweakApplicationSchema>

/** 基于指定快照生成的候选源码，不代表新版本已成功发布。 */
export interface ArtboardTweakApplicationResult {
  source: string
  /** 按显式选择顺序，仅含默认值实际改变的画板。 */
  changed: { id: string; title: string }[]
}

type Adjustment = { id: string; type: ArtboardTweak['type']; value: ArtboardTweakValues[string] }
type TargetStatus = 'changed' | 'unchanged' | 'incompatible'

function sourceAdjustments(
  draft: EditableArtboardSource,
  boardId: string,
  values: ArtboardTweakValues,
): Adjustment[] {
  const source = draft.boards.get(boardId)
  if (!source) throw new Error('源画板不在该版本中')
  return Object.entries(values).map(([id, value]) => {
    const field = source.board.tweaks?.find((field) => field.id === id)
    if (!field || !acceptsArtboardTweakValue(field, value) || field.default === value) {
      throw new Error(`参数 ${id} 不是源画板的有效调整`)
    }
    return { id, type: field.type, value }
  })
}

function targetStatus(board: ArtboardBoard, adjustments: readonly Adjustment[]): TargetStatus {
  let changed = false
  for (const { id, type, value } of adjustments) {
    const field = board.tweaks?.find((field) => field.id === id)
    if (!field || field.type !== type || !acceptsArtboardTweakValue(field, value)) {
      return 'incompatible'
    }
    if (field.default !== value) changed = true
  }
  return changed ? 'changed' : 'unchanged'
}

/** 按源码顺序列出所有画板；任一调整不兼容时整板不可采用。 */
export function listArtboardTweakTargets(
  source: string,
  version: number,
  boardId: string,
  values: ArtboardTweakValues,
): readonly { id: string; title: string; status: TargetStatus }[] {
  const draft = readEditableArtboardSource(source, version)
  const adjustments = sourceAdjustments(draft, boardId, changedValues.parse(values))
  return Array.from(draft.boards, ([id, { board }]) => ({
    id,
    title: board.title,
    status: targetStatus(board, adjustments),
  }))
}

/** 仅更新显式目标的默认值；目标消失、不兼容或已无变化时整次拒绝。 */
export function applyArtboardTweakApplication(
  source: string,
  version: number,
  application: ArtboardTweakApplication,
): ArtboardTweakApplicationResult {
  const { boardId, targetIds, values } = ArtboardTweakApplicationSchema.parse(application)
  const draft = readEditableArtboardSource(source, version)
  const adjustments = sourceAdjustments(draft, boardId, values)
  const changed = targetIds.map((id) => {
    const target = draft.boards.get(id)
    if (!target || targetStatus(target.board, adjustments) !== 'changed') {
      throw new Error(`目标画板 ${id} 不存在、不兼容或已无变化`)
    }
    // 可编辑索引已校验同一组声明；只改原始字段，保留解析模型未收录的作者数据。
    const fields = target.raw.tweaks as { id: string; default: ArtboardTweakValues[string] }[]
    for (const field of fields) {
      if (Object.hasOwn(values, field.id)) field.default = values[field.id]
    }
    return { id, title: target.board.title }
  })
  return { source: JSON.stringify(draft.raw, null, 2), changed }
}
