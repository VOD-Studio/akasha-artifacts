import { parseArtboardValue } from '@akasha/protocol'
import { canvasIds } from './canvas-model'

/** 对指定制品基准版本中页面的整次变更。 */
export type CanvasPageEdit =
  | { kind: 'create'; id: string; title: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'delete'; id: string }

interface ArtboardSource {
  pages?: unknown
  boards: Array<Record<string, unknown>>
  flows?: unknown
}

/** 保留未知源码字段；修改同时固化旧源码中推断出的标识，避免定位链接随改名或删除漂移。 */
export function editCanvasPages(source: string, baseVersion: number, edit: CanvasPageEdit): string {
  const value: unknown = JSON.parse(source)
  const parsed = parseArtboardValue(value)
  if (!parsed.ok) throw new Error(parsed.error)
  const raw = value as ArtboardSource
  const { pages, boards } = parsed.data
  const pageIds = canvasIds(pages, 'page', baseVersion)
  const boardIds = canvasIds(boards, 'board', baseVersion)
  if (pageIds.size !== pages.length || boardIds.size !== boards.length) {
    throw new Error('当前源码有重复的页面或画板标识，请修正后再编辑')
  }
  const target = pages.find((page) => pageIds.get(page.id) === edit.id)
  if (edit.kind !== 'create' && !target) throw new Error('该页面已不存在')
  if (edit.kind === 'create' && target) throw new Error('页面标识已存在')

  const rawPages: unknown[] = Array.isArray(raw.pages) ? raw.pages : []
  // 解析器只略过非对象条目，保留这些条目的源码，但不让它们错配后面的标识。
  let pageIndex = 0
  const nextPages = rawPages.filter((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return true
    const record = entry as Record<string, unknown>
    const page = pages[pageIndex++]
    if (!page) return true
    if (edit.kind === 'delete' && page === target) return false
    if (page.inferredId) {
      record.id = pageIds.get(page.id)
      record.title = page.title
    }
    if (edit.kind === 'rename' && page === target) record.title = edit.title
    return true
  })
  if (edit.kind === 'create') {
    nextPages.push({ id: edit.id, title: edit.title, includeSharedBoards: false })
  }
  raw.pages = nextPages

  const removed = new Set<string>()
  raw.boards = raw.boards.filter((entry, index) => {
    const board = boards[index]
    if (!board) return true
    if (edit.kind === 'delete' && board.pageId === target?.id) {
      removed.add(board.id)
      return false
    }
    if (board.inferredId) entry.id = boardIds.get(board.id)
    const pageId = board.pageId && pageIds.get(board.pageId)
    if (pageId && pageId !== board.pageId) entry.pageId = pageId
    return true
  })

  if (Array.isArray(raw.flows)) {
    raw.flows = raw.flows.filter((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || !('from' in entry) || !('to' in entry)) return true
      for (const endpoint of ['from', 'to'] as const) {
        const id = entry[endpoint]
        if (typeof id !== 'string') continue
        const normalized = id.trim()
        if (removed.has(normalized)) return false
        const stableId = boardIds.get(normalized)
        if (stableId && stableId !== normalized) entry[endpoint] = stableId
      }
      return true
    })
  }

  return JSON.stringify(raw, null, 2)
}
