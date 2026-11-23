import { canvasIds, parseArtboardValue } from '@akasha/protocol'

/** 把画布显示的稳定标识解析为该快照中唯一的 HTML 片段。 */
export function visualBoardSource(source: string, version: number, boardId: string) {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return null
  }
  const parsed = parseArtboardValue(raw)
  if (!parsed.ok) return null
  const { boards } = parsed.data
  const ids = canvasIds(boards, 'board', version)
  if (ids.size !== boards.length) return null
  const index = boards.findIndex(({ id }) => ids.get(id) === boardId)
  const html = boards[index]?.html
  if (html === undefined) return null
  const document = raw as { boards: Array<Record<string, unknown>> }
  return {
    html,
    replace(next: string) {
      if (next === html) return source
      document.boards[index].html = next
      return JSON.stringify(document, null, 2)
    },
  }
}
