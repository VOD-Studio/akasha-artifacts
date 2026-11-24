import { type ArtboardBoard, type ArtboardData, canvasIds, parseArtboard } from './artboard.js'

/** 布局与播放入口所需的单板元数据；正文一律通过单板读取。 */
export interface ArtboardIndexBoard
  extends Pick<
    ArtboardBoard,
    | 'id'
    | 'title'
    | 'subtitle'
    | 'viewport'
    | 'position'
    | 'layoutGroup'
    | 'recommended'
    | 'presentation'
    | 'legacyId'
  > {
  /** 外壳无需读取正文就能裁剪轮廓和缩略图；颜色仍只随正文派发。 */
  cornerRadius?: number
  /** 解析后的页面 id；无归属且非 `unplaced` 时是共享画板。 */
  pageId?: string
  /** 源稿引用了不存在的页面，显示在未分组页而不作为共享画板。 */
  unplaced?: true
}

/** 单独派发到沙盒的不可变正文；`html` 缺省时用纯文本说明生成画面。 */
export type ArtboardContent = Pick<
  ArtboardBoard,
  'id' | 'html' | 'description' | 'designLayers' | 'appearance' | 'tweaks'
>

/** 版本化的布局索引，使用工作区链接里的稳定标识，不携带正文。 */
export interface ArtboardIndex
  extends Pick<ArtboardData, 'columns' | 'showFlows' | 'handDrawnFlows' | 'flows'> {
  /** 顺序决定页面栏位；推断标识已按固定版本解析。 */
  pages: Array<Pick<ArtboardData['pages'][number], 'id' | 'title' | 'includeSharedBoards'>>
  /** 每个稳定标识至多出现一次；共享画板只列一次。 */
  boards: ArtboardIndexBoard[]
}

/** 可随整稿重建的读模型，不参与版本冲突、写入或导出。 */
export interface ArtboardProjection {
  /** 前端打开作品时的布局元数据。 */
  index: ArtboardIndex
  /** 与索引使用相同标识和版本的画板正文。 */
  contents: ArtboardContent[]
}

/** 兼容旧稿的推断标识；无法解析的历史稿由原有错误渲染器处理。 */
export function projectArtboard(source: string, version: number): ArtboardProjection | null {
  const result = parseArtboard(source)
  if (!result.ok) return null
  const { pages, boards, flows, columns, showFlows, handDrawnFlows } = result.data
  const pageIds = canvasIds(pages, 'page', version)
  const boardIds = canvasIds(boards, 'board', version)
  const indexBoards: ArtboardIndexBoard[] = []
  const contents: ArtboardContent[] = []
  const seen = new Set<string>()
  for (const board of boards) {
    const id = boardIds.get(board.id) ?? board.id
    if (seen.has(id)) continue
    seen.add(id)
    const pageId = board.pageId && pageIds.get(board.pageId)
    indexBoards.push({
      id,
      title: board.title,
      subtitle: board.subtitle,
      viewport: board.viewport,
      cornerRadius: board.appearance?.cornerRadius,
      position: board.position,
      layoutGroup: board.layoutGroup,
      recommended: board.recommended,
      presentation: board.presentation,
      legacyId: id === board.id ? board.legacyId : board.id,
      ...(pageId ? { pageId } : {}),
      ...(board.pageId && !pageId ? { unplaced: true } : {}),
    })
    contents.push({
      id,
      html: board.html,
      description: board.description,
      designLayers: board.designLayers,
      appearance: board.appearance,
      tweaks: board.tweaks,
    })
  }
  return {
    index: {
      pages: pages.map(({ id, title, includeSharedBoards }) => ({
        id: pageIds.get(id) ?? id,
        title,
        includeSharedBoards,
      })),
      boards: indexBoards,
      columns,
      showFlows,
      handDrawnFlows,
      flows: flows.map(({ from, to, label }) => ({
        from: boardIds.get(from) ?? from,
        to: boardIds.get(to) ?? to,
        label,
      })),
    },
    contents,
  }
}
