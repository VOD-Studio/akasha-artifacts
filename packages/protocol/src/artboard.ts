/** `position` 与 `viewport` 在作者和画布编辑器中的共同约束。 */
export const ARTBOARD_GEOMETRY_LIMITS = { coordinate: 1_000_000, viewport: 8192 } as const

/** 画布页面：制品内的一组画板。 */
export interface ArtboardPage {
  /** 源码里的 `id`；缺省时按数组下标生成 `page-<n>`。 */
  id: string
  /** `id` 不是作者写的，而是解析时推断出来的。 */
  inferredId?: true
  /** 缺省回落为 `id`。 */
  title: string
  /** 为 `false` 时不显示未指定 `pageId` 的共享画板；缺省为显示。 */
  includeSharedBoards?: false
}

/** 画板：画布上的一个设计画面。 */
export interface ArtboardBoard {
  /** 源码里的 `id`；缺省时按数组下标生成 `board-<n>`。流程连线以它引用画板。 */
  id: string
  /** `id` 不是作者写的，而是解析时推断出来的。 */
  inferredId?: true
  /** 首次保存旧制品时保留的隐式 ID，供原有原型导航引用。 */
  legacyId?: string
  /** 必填；缺失时整个制品解析失败。 */
  title: string
  /** 画板标题旁的辅助说明。 */
  subtitle?: string
  /** 所属页面的 `ArtboardPage.id`。 */
  pageId?: string
  /** 作者声明的画板分组标识。 */
  groupId?: string
  /** 同组画板在同一画布页面可一起选择和移动；不参与评审分组。 */
  layoutGroup?: string
  /** 画板固有尺寸；宽高均为 1–8192 的整数才保留，否则丢弃。 */
  viewport?: { width: number; height: number }
  /** 绝对画布坐标，单位 CSS 像素；缺省时仍参加自动排列。 */
  position?: { x: number; y: number }
  /** 标记为推荐方案。 */
  recommended?: boolean
  /** 画板内容的 HTML 片段。 */
  html?: string
  /** 没有 HTML 时用来生成画板内容的纯文本。 */
  description?: string
  /** 作者提供的画板标签。 */
  tags?: string[]
}

/** 流程连线：从一个画板指向另一个画板。 */
export interface ArtboardFlow {
  /** 起点画板 id。 */
  from: string
  /** 终点画板 id。 */
  to: string
  /** 可选的流程连线说明。 */
  label?: string
}

/** `artboard` 制品源码解析后的数据。 */
export interface ArtboardData {
  /** 缺省为「并排方案画板」。 */
  title: string
  /** 制品主标题下的辅助说明。 */
  subtitle?: string
  /** 每行画板数，解析后收敛到 1–4。 */
  columns: number
  /** 是否绘制流程连线。 */
  showFlows: boolean
  /** 流程连线是否用手绘风格。 */
  handDrawnFlows: boolean
  /** 可为空数组。 */
  pages: ArtboardPage[]
  /** `boards` 不是数组时解析失败。 */
  boards: ArtboardBoard[]
  /** 只保留 `from`、`to` 均非空的连线。 */
  flows: ArtboardFlow[]
}

type ArtboardParseResult = { ok: true; data: ArtboardData } | { ok: false; error: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined
}

function validSize(value: number | undefined): value is number {
  return (
    value !== undefined &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= ARTBOARD_GEOMETRY_LIMITS.viewport
  )
}

/**
 * 解析 `artboard` 制品源码。
 *
 * @remarks 容错策略：`pages`、`flows` 里的非法项静默丢弃，`boards` 里的非法项则整体报错。
 */
export function parseArtboard(source: string): ArtboardParseResult {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
  return parseArtboardValue(value)
}

/** 对已反序列化的制品应用与 `parseArtboard` 相同的校验及容错。 */
export function parseArtboardValue(value: unknown): ArtboardParseResult {
  const data = asRecord(value)
  if (!data) return { ok: false, error: '模板源码必须为 JSON 对象' }

  const rawBoards = data.boards
  if (!Array.isArray(rawBoards)) {
    return { ok: false, error: 'artboard 缺少数组字段 "boards"' }
  }

  const pages: ArtboardPage[] = []
  if (Array.isArray(data.pages)) {
    for (let i = 0; i < data.pages.length; i++) {
      const rec = asRecord(data.pages[i])
      if (!rec) continue
      const authoredId = asString(rec.id)?.trim()
      const id = authoredId || `page-${i + 1}`
      pages.push({
        id,
        title: asString(rec.title)?.trim() || id,
        ...(!authoredId && { inferredId: true }),
        ...(rec.includeSharedBoards === false && { includeSharedBoards: false }),
      })
    }
  }

  const boards: ArtboardBoard[] = []
  for (let i = 0; i < rawBoards.length; i++) {
    const rec = asRecord(rawBoards[i])
    if (!rec) return { ok: false, error: `boards[${i}] 必须为对象` }
    const authoredId = asString(rec.id)?.trim()
    const id = authoredId || `board-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `boards[${i}] 缺少 title` }
    const viewport = asRecord(rec.viewport)
    const width = asNumber(viewport?.width)
    const height = asNumber(viewport?.height)
    const position = asRecord(rec.position)
    const x = asNumber(position?.x)
    const y = asNumber(position?.y)
    boards.push({
      id,
      title,
      ...(!authoredId && { inferredId: true }),
      legacyId: asString(rec.legacyId)?.trim() || undefined,
      subtitle: asString(rec.subtitle),
      pageId: asString(rec.pageId),
      groupId: asString(rec.groupId),
      layoutGroup: asString(rec.layoutGroup)?.trim() || undefined,
      ...(validSize(width) && validSize(height) ? { viewport: { width, height } } : {}),
      ...(x !== undefined &&
      y !== undefined &&
      Math.abs(x) <= ARTBOARD_GEOMETRY_LIMITS.coordinate &&
      Math.abs(y) <= ARTBOARD_GEOMETRY_LIMITS.coordinate
        ? { position: { x, y } }
        : {}),
      recommended: asBoolean(rec.recommended),
      html: asString(rec.html),
      description: asString(rec.description),
      tags: asStringArray(rec.tags),
    })
  }

  const flows: ArtboardFlow[] = []
  if (Array.isArray(data.flows)) {
    for (const item of data.flows) {
      const rec = asRecord(item)
      if (!rec) continue
      const from = asString(rec.from)?.trim()
      const to = asString(rec.to)?.trim()
      if (from && to) {
        flows.push({ from, to, label: asString(rec.label) })
      }
    }
  }

  const rawCols = asNumber(data.columns)
  const columns = rawCols
    ? Math.min(4, Math.max(1, Math.round(rawCols)))
    : Math.min(2, Math.max(1, boards.length))

  return {
    ok: true,
    data: {
      title: asString(data.title) ?? '并排方案画板',
      subtitle: asString(data.subtitle),
      columns,
      showFlows: asBoolean(data.showFlows) ?? true,
      handDrawnFlows: asBoolean(data.handDrawnFlows) ?? true,
      pages,
      boards,
      flows,
    },
  }
}
