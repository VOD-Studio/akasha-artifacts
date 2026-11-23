import {
  type ArtboardPage,
  type ArtifactType,
  type ElementRef,
  parseArtboard,
} from '@akasha/protocol'

/** 画布上的一块画板。 */
export interface CanvasBoard {
  id: string
  title: string
  subtitle?: string
  recommended?: boolean
  /** 画板 id 被改写以保持稳定时，保留源码里原来的 id。 */
  legacyBlockId?: string
  width: number
  height: number
  type: ArtifactType
  source: string
  /** 从说明合成的内容并非源码片段。 */
  generated?: true
  /** 是否有独立的画板作用域；独立制品的默认画板为 false。 */
  scoped: boolean
}

export interface CanvasPage {
  id: string
  title: string
  boards: readonly CanvasBoard[]
  /** 署名页面上的直属画板数；总览等虚拟页面不支持改名或删除。 */
  ownedBoardCount?: number
}

/** 当前页面与选板；没有选中的画板时只记录页面。 */
export interface CanvasLocation {
  pageId: string
  boardId?: string
}

/** 制品的画布文档：若干页面，每页若干画板。 */
export interface CanvasDocument {
  pages: readonly CanvasPage[]
  columns: number
  /** 画板之间的流程连线，两端是画板 id。 */
  flows: readonly { from: string; to: string; label?: string }[]
  /** 只控制画布上的箭头，不影响试玩中声明的导航。 */
  showFlows: boolean
  handDrawnFlows: boolean
}

/** 非 `artboard` 制品在画布上的唯一画板的 id。 */
export const STANDALONE_BOARD_ID = 'main'

// 画板没有声明尺寸时的默认视口，单位 CSS 像素
const DEFAULT_VIEWPORT = { width: 1280, height: 800 }

function descriptionMarkup(description: string) {
  const text = description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<p class="p-4 text-sm">${text}</p>`
}

/** 以基准版本的可见标识定位旧对象，持久化编辑须保留该标识。 */
export function canvasIds(
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

/**
 * 把制品源码转成画布文档。
 *
 * @remarks 只有 `artboard` 类型会解析出多页面与多画板；其余类型，以及解析失败时，
 * 都落在一块默认画板上。`props` 里可以覆盖每行列数、是否显示连线与手绘风格。
 */
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
      showFlows: false,
      handDrawnFlows: false,
    }
  }

  const data = parsed.data
  const pageIds = canvasIds(data.pages, 'page', version)
  const boardIds = canvasIds(data.boards, 'board', version)
  const pageDefinitions = new Map<string, ArtboardPage>()
  for (const page of data.pages) pageDefinitions.set(page.id, page)
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
      ...(board.html === undefined ? { generated: true } : {}),
      scoped: true,
      ...(board.viewport ?? DEFAULT_VIEWPORT),
    }
    if (!board.pageId) {
      shared.push(entry)
    } else if (pageDefinitions.has(board.pageId)) {
      const page = boardsByPage.get(board.pageId)
      if (page) page.push(entry)
      else boardsByPage.set(board.pageId, [entry])
    } else {
      unplaced.push(entry)
    }
  }
  const pages: CanvasPage[] = []
  let showsSharedBoards = false
  for (const { id, title, includeSharedBoards } of pageDefinitions.values()) {
    const own = boardsByPage.get(id)
    const showShared = includeSharedBoards !== false
    showsSharedBoards ||= showShared
    pages.push({
      id: pageIds.get(id) ?? id,
      title,
      ownedBoardCount: own?.length ?? 0,
      boards: showShared
        ? own?.length && shared.length
          ? [...own, ...shared]
          : (own ?? shared)
        : (own ?? []),
    })
  }
  if (pages.length === 0 || unplaced.length !== 0 || (shared.length !== 0 && !showsSharedBoards)) {
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
    flows: data.flows.map(({ from, to, label }) => ({
      from: boardIds.get(from) ?? from,
      to: boardIds.get(to) ?? to,
      label,
    })),
    showFlows: Boolean(overlay?.showFlows ?? data.showFlows),
    handDrawnFlows: Boolean(overlay?.handDrawnFlows ?? data.handDrawnFlows),
  }
}

interface BlockPlacement {
  boardId: string
  blockId: string
}

/**
 * 返回一个函数，为只带 `blockId` 的历史反馈补上画板归属。
 *
 * @returns 元素已带 `boardId` 或没有 `blockId` 时原样返回；否则按画板源码里的
 * `data-ak-block` 找到所属画板并补上 `boardId`。同一个块标识出现在多个画板时不补。
 */
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
