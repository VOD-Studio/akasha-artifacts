import {
  ARTIFACT_DEFAULT_VIEWPORT,
  type ArtboardAppearance,
  type ArtboardContent,
  type ArtboardIndex,
  type ArtboardLayoutGuide,
  type ArtboardPresentation,
  type ArtboardPrintLayout,
  type ArtboardTweak,
  type ArtifactType,
  type DesignLayer,
  projectArtboard,
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
  /** 随索引提供；未声明的能力由渲染器报告。 */
  presentation?: ArtboardPresentation
  /** 画板 id 被改写以保持稳定时，保留源码里原来的 id。 */
  legacyBlockId?: string
  /** 画板独立视口宽度，单位为 CSS 像素。 */
  width: number
  /** 画板独立视口高度，单位为 CSS 像素。 */
  height: number
  /** 外壳轮廓的圆角，归一化到画板固有尺寸。 */
  cornerRadius?: number
  /** 随正文读取；未声明时使用白底与直角，不影响布局。 */
  appearance?: ArtboardAppearance
  /** 缺省沿用固定版式；不改变画布视口。 */
  printLayout?: ArtboardPrintLayout
  /** 索引中的板内坐标；显隐由当前视图管理。 */
  layoutGuides?: ArtboardLayoutGuide[]
  /** 传给沙盒的渲染器类型；并排多画板的每块内容是 HTML。 */
  type: ArtifactType
  /** 未声明时沿用旧制品的网格布局。 */
  position?: { x: number; y: number }
  /** 同一页面内共用选择和位置变换。 */
  layoutGroup?: string
  /** 只有已读取的画板才带正文；未读取和空白画板不是同一状态。 */
  source?: string
  designLayers?: DesignLayer[]
  /** 从说明合成的内容并非源码片段。 */
  generated?: true
  /** 是否有独立的画板作用域；独立制品的默认画板为 false。 */
  scoped: boolean
}

/** 可交给沙盒、导出和源码工具渲染的画板。 */
export interface LoadedCanvasBoard extends CanvasBoard {
  source: string
  /** 固定版本声明的参数，不包含当前浏览会话的覆写。 */
  tweaks?: ArtboardTweak[]
}

/** 负责显示一组画板的页面；总览和未分组页可以由模型生成。 */
export interface CanvasPage<B extends CanvasBoard = CanvasBoard> {
  /** 稳定的页面定位；空串是合成页面，不是持久化 ID。 */
  id: string
  title: string
  /** 顺序用于总览和导出；可包含由多页共用的画板。 */
  boards: readonly B[]
  /** 署名页面上的直属画板数；总览等虚拟页面不支持改名或删除。 */
  ownedBoardCount?: number
}

/** 当前页面与选板；没有选中的画板时只记录页面。 */
export interface CanvasLocation {
  pageId: string
  boardId?: string
}

/** 制品的画布文档：若干页面，每页若干画板。 */
export interface CanvasDocument<B extends CanvasBoard = CanvasBoard> {
  pages: readonly CanvasPage<B>[]
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

/** 拼合一块已读取的画板；文字说明只作为纯文本显示。 */
export function loadCanvasBoard(board: CanvasBoard, content: ArtboardContent): LoadedCanvasBoard {
  return {
    ...board,
    source: content.html ?? descriptionMarkup(content.description ?? '空白画板'),
    ...(content.html === undefined ? { generated: true } : {}),
    designLayers: content.designLayers,
    appearance: content.appearance,
    tweaks: content.tweaks,
  }
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
): CanvasDocument<LoadedCanvasBoard> {
  const projection = type === 'artboard' ? projectArtboard(source, version) : null
  if (!projection) {
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

  const contents = new Map(projection.contents.map((content) => [content.id, content]))
  return composeDocument(projection.index, props, (board) => {
    const content = contents.get(board.id)
    if (!content) throw new Error(`缺少画板 ${board.id} 的源稿`)
    return loadCanvasBoard(board, content)
  })
}

/** 根据索引生成页面与几何，不访问任何画板正文。 */
export function createCanvasDocumentFromIndex(
  canvas: ArtboardIndex,
  props?: unknown,
): CanvasDocument {
  return composeDocument(canvas, props, (board) => board)
}

function composeDocument<B extends CanvasBoard>(
  data: ArtboardIndex,
  props: unknown,
  materialize: (board: CanvasBoard) => B,
): CanvasDocument<B> {
  const unplaced: B[] = []
  const shared: B[] = []
  const boardsByPage = new Map<string, B[]>()
  for (const board of data.boards) {
    const entry = materialize({
      id: board.id,
      title: board.title,
      subtitle: board.subtitle,
      recommended: board.recommended,
      presentation: board.presentation,
      legacyBlockId: board.legacyId,
      type: 'html',
      scoped: true,
      ...(board.viewport ?? ARTIFACT_DEFAULT_VIEWPORT),
      cornerRadius: board.cornerRadius,
      printLayout: board.printLayout,
      layoutGuides: board.layoutGuides,
      position: board.position,
      layoutGroup: board.layoutGroup,
    })
    if (board.unplaced) {
      unplaced.push(entry)
    } else if (board.pageId) {
      const page = boardsByPage.get(board.pageId)
      if (page) page.push(entry)
      else boardsByPage.set(board.pageId, [entry])
    } else {
      shared.push(entry)
    }
  }
  const pages: CanvasPage<B>[] = []
  let showsSharedBoards = false
  for (const { id, title, includeSharedBoards } of new Map(
    data.pages.map((page) => [page.id, page]),
  ).values()) {
    const own = boardsByPage.get(id)
    const showShared = includeSharedBoards !== false
    showsSharedBoards ||= showShared
    const fallback = own ?? (showShared ? shared : [])
    const boards = showShared && own?.length && shared.length ? [...own, ...shared] : fallback
    pages.push({
      id,
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
    flows: data.flows,
    showFlows: Boolean(overlay?.showFlows ?? data.showFlows),
    handDrawnFlows: Boolean(overlay?.handDrawnFlows ?? data.handDrawnFlows),
  }
}
