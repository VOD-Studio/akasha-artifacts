import type { Artifact, EditOp, Version } from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/** 指定源码位置的直改状态，供工作台判断可以提供哪些编辑操作。 */
export interface VisualEditTarget {
  /** 源码中的标签名，用于标识编辑目标。 */
  tagName: string
  /** 可直接改写的字面量文本；不可改写时为 `null`。 */
  text: string | null
  /** class 字面量；缺省或不是字面量时为空串。 */
  className: string
  /** 同一父节点下的静态兄弟顺序；没有至少两个可排序兄弟时为 `null`。 */
  order: { parentLoc: string; siblings: Array<{ loc: string; label: string }> } | null
}

/**
 * 一次直改或撤销。省略 `boardId` 时直接定位制品源码；指定画板时只支持静态文字。
 * `undoVersion` 是服务端给出的待撤销直改版本号，不是要恢复到的版本号。
 */
export type VisualEditCommand = { op: EditOp; boardId?: string } | { undoVersion: number }

/**
 * 定位可修改的源码元素；`target: null` 表示该基准版本没有可编辑目标。
 *
 * @param input - `loc` 是基准源码中的位置；指定 `boardId` 时改用该画板内的源码位置。
 * @throws 基准已不是头版本时拒绝，而不是返回 `target: null`。
 */
export async function fetchVisualEditTarget(
  id: string,
  input: { project: string; baseVersion: number; loc: string; boardId?: string },
): Promise<{ target: VisualEditTarget | null }> {
  const query = new URLSearchParams({
    project: input.project,
    baseVersion: String(input.baseVersion),
    loc: input.loc,
  })
  if (input.boardId !== undefined) query.set('boardId', input.boardId)
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit?${query}`)
}

/** 查找当前基准上的可撤销直改版本；为空则不提供撤销。基准过期时拒绝请求。 */
export async function fetchVisualUndo(
  id: string,
  input: { project: string; baseVersion: number },
): Promise<{ undoVersion: number | null }> {
  const query = new URLSearchParams({
    project: input.project,
    baseVersion: String(input.baseVersion),
  })
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit?${query}`)
}

/**
 * 计算应用编辑后的完整源码，不发布版本、也不通知 Agent。
 *
 * @throws 基准过期或操作无效时拒绝；不支持的直改以 `annotationOnly` 提示转为批注。
 */
export async function previewVisualEdit(
  id: string,
  input: { project: string; baseVersion: number } & VisualEditCommand,
): Promise<{ source: string }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 仅供人类作者提交元素编辑或撤销。源码变更时写入新版本并生成直改反馈；无变化则返回原头版本。
 *
 * @throws 基准已过期时由调用方处理版本冲突；不再符合撤销条件时也拒绝请求。
 */
export async function saveVisualEdit(
  id: string,
  input: { project: string; baseVersion: number } & VisualEditCommand,
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
