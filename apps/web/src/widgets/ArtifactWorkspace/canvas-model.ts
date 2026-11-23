import { type ArtifactType, type ElementRef, parseArtboard } from '@akasha/protocol'

export interface CanvasBoard {
  id: string
  title: string
  subtitle?: string
  recommended?: boolean
  legacyBlockId?: string
  width: number
  height: number
  type: ArtifactType
  source: string
  scoped: boolean
}

export interface CanvasPage {
  id: string
  title: string
  boards: readonly CanvasBoard[]
}

export interface CanvasDocument {
  pages: readonly CanvasPage[]
  columns: number
  flows: readonly { from: string; to: string; label?: string }[]
  handDrawnFlows: boolean
}

export const STANDALONE_BOARD_ID = 'main'

const DEFAULT_VIEWPORT = { width: 1280, height: 800 }

function descriptionMarkup(description: string) {
  const text = description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<p class="p-4 text-sm">${text}</p>`
}

function canvasIds(
  items: readonly { id: string; title: string; inferredId?: true }[],
  kind: 'page' | 'board',
  version: number,
) {
  const ids = new Map<string, string>()
  const titles = new Map<string, number>()
  for (const { id, title, inferredId } of items) {
    titles.set(title, (titles.get(title) ?? 0) + 1)
    if (!inferredId) ids.set(id, id)
  }
  const used = new Set(ids.values())
  for (const { id, title, inferredId } of items) {
    if (!inferredId || ids.has(id)) continue
    // 旧版没有作者标识时，重排不能把链接转给同位置的另一个对象。
    const named = `legacy-${kind}:${title}`
    let key =
      title !== id && titles.get(title) === 1 && !used.has(named)
        ? named
        : `legacy-${kind}:v${version}:${id}`
    while (used.has(key)) key += ':'
    used.add(key)
    ids.set(id, key)
  }
  return ids
}

export function createCanvasDocument(
  type: ArtifactType,
  title: string,
  source: string,
  version: number,
  props: unknown,
): CanvasDocument {
  const parsed = type === 'artboard' ? parseArtboard(source) : null
  if (!parsed?.ok) {
    return {
      pages: [
        {
          id: '',
          title: '总览',
          boards: [
            { id: STANDALONE_BOARD_ID, title, type, source, scoped: false, ...DEFAULT_VIEWPORT },
          ],
        },
      ],
      columns: 1,
      flows: [],
      handDrawnFlows: false,
    }
  }

  const data = parsed.data
  const pageIds = canvasIds(data.pages, 'page', version)
  const boardIds = canvasIds(data.boards, 'board', version)
  const pageTitles = new Map<string, string>()
  for (const page of data.pages) pageTitles.set(page.id, page.title)
  const unplaced: CanvasBoard[] = []
  const shared: CanvasBoard[] = []
  const boardsByPage = new Map<string, CanvasBoard[]>()
  const placed = new Set<string>()
  for (const board of data.boards) {
    if (placed.has(board.id)) continue
    placed.add(board.id)
    const id = boardIds.get(board.id) ?? board.id
    const entry: CanvasBoard = {
      id,
      title: board.title,
      subtitle: board.subtitle,
      recommended: board.recommended,
      ...(id !== board.id ? { legacyBlockId: board.id } : {}),
      type: 'html',
      source: board.html ?? descriptionMarkup(board.description ?? '空白画板'),
      scoped: true,
      ...(board.viewport ?? DEFAULT_VIEWPORT),
    }
    if (!board.pageId) {
      shared.push(entry)
    } else if (pageTitles.has(board.pageId)) {
      const page = boardsByPage.get(board.pageId)
      if (page) page.push(entry)
      else boardsByPage.set(board.pageId, [entry])
    } else {
      unplaced.push(entry)
    }
  }
  const pages: CanvasPage[] = []
  for (const [id, title] of pageTitles) {
    const own = boardsByPage.get(id)
    pages.push({ id: pageIds.get(id) ?? id, title, boards: own ? [...own, ...shared] : shared })
  }
  if (pages.length === 0 || unplaced.length !== 0) {
    pages.push({
      id: '',
      title: pages.length ? '未分组' : '总览',
      boards: [...unplaced, ...shared],
    })
  }
  const overlay =
    props && typeof props === 'object' && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : undefined
  return {
    pages,
    columns:
      typeof overlay?.columns === 'number' && Number.isFinite(overlay.columns)
        ? Math.min(4, Math.max(1, Math.round(overlay.columns)))
        : data.columns,
    flows:
      (overlay?.showFlows ?? data.showFlows)
        ? data.flows.map(({ from, to, label }) => ({
            from: boardIds.get(from) ?? from,
            to: boardIds.get(to) ?? to,
            label,
          }))
        : [],
    handDrawnFlows: Boolean(overlay?.handDrawnFlows ?? data.handDrawnFlows),
  }
}

interface BlockPlacement {
  boardId: string
  blockId: string
}

export function createCanvasElementResolver(canvas: CanvasDocument) {
  let legacyBoards: Map<string, BlockPlacement | null> | undefined
  return (element: ElementRef): ElementRef => {
    if (element.boardId || !element.blockId) return element
    legacyBoards ??= indexLegacyBlocks(canvas)
    const placement = legacyBoards.get(element.blockId)
    return placement ? { ...element, ...placement } : element
  }
}

function indexLegacyBlocks(canvas: CanvasDocument) {
  const placements = new Map<string, BlockPlacement | null>()
  const add = (key: string, boardId: string, blockId = key) => {
    const previous = placements.get(key)
    if (previous === undefined) placements.set(key, { boardId, blockId })
    else if (previous?.boardId !== boardId || previous.blockId !== blockId)
      placements.set(key, null)
  }
  const seen = new Set<string>()
  // 只在未带 boardId 的历史反馈上读取惰性模板；不把源码节点插入工作台 DOM。
  const template = document.createElement('template')
  for (const page of canvas.pages) {
    for (const board of page.boards) {
      if (!board.scoped || seen.has(board.id)) continue
      seen.add(board.id)
      add(board.id, board.id)
      if (board.legacyBlockId) add(board.legacyBlockId, board.id, board.id)
      template.innerHTML = board.source
      for (const node of template.content.querySelectorAll('[data-ak-block]')) {
        const id = node.getAttribute('data-ak-block')?.trim()
        if (id) add(id, board.id)
      }
    }
  }
  return placements
}
