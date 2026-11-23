/** 画布页面：制品内的一组画板。 */
export interface ArtboardPage {
  /** 源码里的 `id`；缺省时按数组下标生成 `page-<n>`。 */
  id: string
  /** `id` 不是作者写的，而是解析时推断出来的。 */
  inferredId?: true
  /** 缺省回落为 `id`。 */
  title: string
}

/** 画板：画布上的一个设计画面。 */
export interface ArtboardBoard {
  /** 源码里的 `id`；缺省时按数组下标生成 `board-<n>`。流程连线以它引用画板。 */
  id: string
  /** `id` 不是作者写的，而是解析时推断出来的。 */
  inferredId?: true
  /** 必填；缺失时整个制品解析失败。 */
  title: string
  subtitle?: string
  /** 所属页面的 `ArtboardPage.id`。 */
  pageId?: string
  groupId?: string
  /** 画板固有尺寸；宽高均为 1–8192 的整数才保留，否则丢弃。 */
  viewport?: { width: number; height: number }
  /** 标记为推荐方案。 */
  recommended?: boolean
  /** 画板内容的 HTML 片段。 */
  html?: string
  description?: string
  tags?: string[]
}

/** 流程连线：从一个画板指向另一个画板。 */
export interface ArtboardFlow {
  /** 起点画板 id。 */
  from: string
  /** 终点画板 id。 */
  to: string
  label?: string
}

/** `artboard` 制品源码解析后的数据。 */
export interface ArtboardData {
  /** 缺省为「并排方案画板」。 */
  title: string
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
  return value !== undefined && Number.isSafeInteger(value) && value > 0 && value <= 8192
}

/**
 * 解析 `artboard` 制品源码。
 *
 * @remarks 容错策略：`pages`、`flows` 里的非法项静默丢弃，`boards` 里的非法项则整体报错。
 */
export function parseArtboard(source: string): ArtboardParseResult {
  let data: Record<string, unknown> | null
  try {
    data = asRecord(JSON.parse(source))
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
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
    boards.push({
      id,
      title,
      ...(!authoredId && { inferredId: true }),
      subtitle: asString(rec.subtitle),
      pageId: asString(rec.pageId),
      groupId: asString(rec.groupId),
      ...(validSize(width) && validSize(height) ? { viewport: { width, height } } : {}),
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
