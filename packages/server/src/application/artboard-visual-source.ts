import { type EditableArtboardSource, readEditableArtboardSource } from '@akasha/protocol'

/** 把画布显示的稳定标识解析为该快照中唯一的 HTML 片段。 */
export function visualBoardSource(source: string, version: number, boardId: string) {
  let draft: EditableArtboardSource
  try {
    draft = readEditableArtboardSource(source, version)
  } catch {
    return null
  }
  const entry = draft.boards.get(boardId)
  if (!entry || entry.board.html === undefined) return null
  const { html } = entry.board
  return {
    html,
    replace(next: string) {
      if (next === html) return source
      entry.raw.html = next
      return JSON.stringify(draft.raw, null, 2)
    },
  }
}
