import { type ArtboardBoard, type ArtboardPage, parseArtboardValue } from '@akasha/protocol'
import { canvasIds } from './canvas-model'

type RawRecord = Record<string, unknown>
interface EditableCanvasSource {
  raw: RawRecord & { boards: RawRecord[] }
  pages: ReadonlyMap<string, { page: ArtboardPage; raw: RawRecord }>
  boards: ReadonlyMap<string, { board: ArtboardBoard; raw: RawRecord }>
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 保存首次编辑时固化推断出的 ID 和引用，原样保留应用不认识的源码字段。 */
export function readEditableCanvasSource(
  source: string,
  baseVersion: number,
): EditableCanvasSource {
  const value: unknown = JSON.parse(source)
  const parsed = parseArtboardValue(value)
  if (!parsed.ok) throw new Error(parsed.error)
  const raw = value as EditableCanvasSource['raw']
  const { pages, boards } = parsed.data
  const pageIds = canvasIds(pages, 'page', baseVersion)
  const boardIds = canvasIds(boards, 'board', baseVersion)
  if (pageIds.size !== pages.length || boardIds.size !== boards.length) {
    throw new Error('当前源码有重复的页面或画板标识，请修正后再编辑')
  }

  const pageEntries = new Map<string, { page: ArtboardPage; raw: RawRecord }>()
  let pageIndex = 0
  for (const entry of Array.isArray(raw.pages) ? raw.pages : []) {
    if (!isRecord(entry)) continue
    const page = pages[pageIndex++]
    const id = page && pageIds.get(page.id)
    if (!page || !id) continue
    if (page.inferredId) {
      entry.id = id
      entry.title = page.title
    }
    pageEntries.set(id, { page, raw: entry })
  }

  const boardEntries = new Map<string, { board: ArtboardBoard; raw: RawRecord }>()
  for (const [index, entry] of raw.boards.entries()) {
    const board = boards[index]
    const id = board && boardIds.get(board.id)
    if (!board || !id) continue
    if (board.inferredId) {
      entry.id = id
      if (board.id !== id) entry.legacyId = board.id
    }
    const pageId = board.pageId && pageIds.get(board.pageId)
    if (pageId && pageId !== board.pageId) entry.pageId = pageId
    boardEntries.set(id, { board, raw: entry })
  }

  for (const entry of Array.isArray(raw.flows) ? raw.flows : []) {
    if (!isRecord(entry) || !('from' in entry) || !('to' in entry)) continue
    for (const endpoint of ['from', 'to'] as const) {
      const original = entry[endpoint]
      if (typeof original !== 'string') continue
      const stable = boardIds.get(original.trim())
      if (stable && stable !== original.trim()) entry[endpoint] = stable
    }
  }
  return { raw, pages: pageEntries, boards: boardEntries }
}

/** 移除稳定 ID 指定的画板及其流程端点，不改写其他画板。 */
export function removeCanvasBoards(
  { raw, boards }: EditableCanvasSource,
  ids: ReadonlySet<string>,
) {
  const removed = new Set<RawRecord>()
  for (const id of ids) {
    const entry = boards.get(id)
    if (!entry) throw new Error('要删除的画板已不存在')
    removed.add(entry.raw)
  }
  raw.boards = raw.boards.filter((entry) => !removed.has(entry))
  if (Array.isArray(raw.flows)) {
    raw.flows = raw.flows.filter((entry: unknown) => {
      if (!isRecord(entry) || !('from' in entry) || !('to' in entry)) return true
      return ![entry.from, entry.to].some((id) => typeof id === 'string' && ids.has(id.trim()))
    })
  }
}
