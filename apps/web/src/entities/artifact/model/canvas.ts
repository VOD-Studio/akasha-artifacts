import {
  ARTIFACT_DEFAULT_VIEWPORT,
  type ArtboardPage,
  type ArtifactType,
  canvasIds,
  type DesignLayer,
  parseArtboard,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'

/** 画布上的一块画板。 */
export interface CanvasBoard {
  /** 用于页面链接与跨版本选板；兼容旧源码的映射见 `legacyBlockId`。 */
  id: string
  title: string
  /** 作者提供的补充说明；不是占位标题。 */
  subtitle?: string
  /** 作者标注的推荐项，不表示已做评审决定。 */
  recommended?: boolean
  /** 画板 id 被改写以保持稳定时，保留源码里原来的 id。 */
  legacyBlockId?: string
  /** 画板独立视口宽度，单位为 CSS 像素。 */
  width: number
  /** 画板独立视口高度，单位为 CSS 像素。 */
  height: number
  /** 传给沙盒的渲染器类型；并排多画板的每块内容是 HTML。 */
  type: ArtifactType
  /** 未声明时沿用旧制品的网格布局。 */
  position?: { x: number; y: number }
  /** 同一页面内共用选择和位置变换。 */
  layoutGroup?: string
  /** 持久化图层与作者写的 HTML 独立渲染。 */
  designLayers?: DesignLayer[]
  /** 交给沙盒渲染的单板源码，不是外层画布文档。 */
  source: string
  /** 从说明合成的内容并非源码片段。 */
  generated?: true
  /** 是否有独立的画板作用域；独立制品的默认画板为 false。 */
  scoped: boolean
}

/** 负责显示一组画板的页面；总览和未分组页可以由模型生成。 */
export interface CanvasPage {
  /** 稳定的页面定位；空串是合成页面，不是持久化 ID。 */
  id: string
  title: string
  /** 顺序用于总览和导出；可包含由多页共用的画板。 */
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
  /** 只控制画布上的箭头，不影响原型交互中声明的导航。 */
  showFlows: boolean
  /** 只影响画布连线的外观，不改端点和导航顺序。 */
  handDrawnFlows: boolean
}

function descriptionMarkup(description: string) {
  const text = description.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<p class="p-4 text-sm">${text}</p>`
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
            {
              id: STANDALONE_BOARD_ID,
              title,
              type,
              source,
              scoped: false,
              ...ARTIFACT_DEFAULT_VIEWPORT,
            },
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
    const legacyBlockId = id !== board.id ? board.id : board.legacyId
    const entry: CanvasBoard = {
      id,
      title: board.title,
      subtitle: board.subtitle,
      recommended: board.recommended,
      legacyBlockId,
      type: 'html',
      source: board.html ?? descriptionMarkup(board.description ?? '空白画板'),
      ...(board.html === undefined ? { generated: true } : {}),
      scoped: true,
      ...(board.viewport ?? ARTIFACT_DEFAULT_VIEWPORT),
      position: board.position,
      layoutGroup: board.layoutGroup,
      designLayers: board.designLayers,
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
    const fallback = own ?? (showShared ? shared : [])
    const boards = showShared && own?.length && shared.length ? [...own, ...shared] : fallback
    pages.push({
      id: pageIds.get(id) ?? id,
      title,
      ownedBoardCount: own?.length ?? 0,
      boards,
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
