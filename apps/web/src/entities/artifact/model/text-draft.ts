import { type DesignLayer, DesignLayerSchema, type VersionSummary } from '@akasha/protocol'

/** 就地文字编辑的持久定位：源码位置和图层标识仅在原快照内有效。 */
export type CanvasTextTarget =
  | { kind: 'source'; boardId?: string; loc: string; text: string }
  | {
      kind: 'create' | 'native'
      boardId: string
      layer: Extract<DesignLayer, { kind: 'text' | 'note' }>
    }

const prefix = 'akasha:canvas-text:'

/** 所有者与分享视图不共用草稿；键中没有授权链接或作品源码。 */
export function canvasTextDraftKey(project: string, base: VersionSummary, shareExpiresAt?: string) {
  return prefix + JSON.stringify([project, base.artifactId, base.version, shareExpiresAt ?? null])
}

/** 存储不可用或内容无效时仍可编辑当前输入，读取草稿本身不会发布。 */
export function readCanvasTextDraft(
  key: string,
): { target: CanvasTextTarget; value: string } | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || typeof saved.value !== 'string') return null
    const { kind, boardId } = saved
    if (kind === 'source') {
      if (boardId !== undefined && typeof boardId !== 'string') return null
      if (typeof saved.loc !== 'string' || typeof saved.text !== 'string') return null
      return { target: { kind, boardId, loc: saved.loc, text: saved.text }, value: saved.value }
    }
    if ((kind !== 'create' && kind !== 'native') || typeof boardId !== 'string') return null
    const layer = DesignLayerSchema.safeParse(saved.layer)
    if (!layer.success || (layer.data.kind !== 'text' && layer.data.kind !== 'note')) return null
    return { target: { kind, boardId, layer: layer.data }, value: saved.value }
  } catch {
    return null
  }
}

/** 只写重开输入框所需的目标与用户正文，不能序列化调用方附带的完整版本。 */
export function writeCanvasTextDraft(key: string, target: CanvasTextTarget, value: string): void {
  const record =
    target.kind === 'source'
      ? { kind: target.kind, boardId: target.boardId, loc: target.loc, text: target.text, value }
      : { kind: target.kind, boardId: target.boardId, layer: target.layer, value }
  try {
    sessionStorage.setItem(key, JSON.stringify(record))
  } catch {}
}

/** 用户取消或确认为已发布后清理当前快照的未提交正文。 */
export function discardCanvasTextDraft(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {}
}

/** 切换 Hub 身份时不保留上一个用户输入的文字。 */
export function clearCanvasTextDrafts(): void {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  } catch {}
}
