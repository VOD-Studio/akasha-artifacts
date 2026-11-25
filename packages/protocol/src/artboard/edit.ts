import { type ArtboardBoard, type ArtboardPage, canvasIds, parseArtboardValue } from './model.js'

type RawRecord = Record<string, unknown>

/** 提交画布变更之前，已定位的原始文档及与其同源的索引。 */
export interface EditableArtboardSource {
  /** 保留未知字段；索引内的 raw 对象指向同一原始文档。 */
  raw: RawRecord & { boards: RawRecord[] }
  /** 按即将写入的页面 id 索引。 */
  pages: ReadonlyMap<string, { page: ArtboardPage; raw: RawRecord }>
  /** 按基准版本画布中可见的稳定 id 索引。 */
  boards: ReadonlyMap<string, { board: ArtboardBoard; raw: RawRecord }>
  /** 是否固化了推断标识；撤销需要保留固化后的标识与流程端点。 */
  stabilized: boolean
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 保存首次编辑时固化推断出的 ID 和引用，原样保留应用不认识的源码字段。 */
export function readEditableArtboardSource(
  source: string,
  baseVersion: number,
): EditableArtboardSource {
  const value: unknown = JSON.parse(source)
  const parsed = parseArtboardValue(value)
  if (!parsed.ok) throw new Error(parsed.error)
  const raw = value as EditableArtboardSource['raw']
  const { pages, boards } = parsed.data
  const pageIds = canvasIds(pages, 'page', baseVersion)
  const boardIds = canvasIds(boards, 'board', baseVersion)
  if (pageIds.size !== pages.length || boardIds.size !== boards.length) {
    throw new Error('当前源码有重复的页面或画板标识，请修正后再编辑')
  }

  let stabilized = false
  const pageEntries = new Map<string, { page: ArtboardPage; raw: RawRecord }>()
  let pageIndex = 0
  for (const entry of Array.isArray(raw.pages) ? raw.pages : []) {
    if (!isRecord(entry)) continue
    const page = pages[pageIndex++]
    const id = page && pageIds.get(page.id)
    if (!page || !id) continue
    if (page.inferredId) {
      stabilized = true
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
      stabilized = true
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
  return { raw, pages: pageEntries, boards: boardEntries, stabilized }
}

/** 撤销回到旧内容时保留已经固化的标识，不能在新版本里重新推断。 */
export function stabilizeArtboardSource(source: string, version: number): string {
  const draft = readEditableArtboardSource(source, version)
  return draft.stabilized ? JSON.stringify(draft.raw, null, 2) : source
}
