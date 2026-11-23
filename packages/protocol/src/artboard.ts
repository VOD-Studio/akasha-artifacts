export interface ArtboardPage {
  id: string
  inferredId?: true
  title: string
}

export interface ArtboardBoard {
  id: string
  inferredId?: true
  title: string
  subtitle?: string
  pageId?: string
  groupId?: string
  viewport?: { width: number; height: number }
  recommended?: boolean
  html?: string
  description?: string
  tags?: string[]
}

export interface ArtboardFlow {
  from: string
  to: string
  label?: string
}

export interface ArtboardData {
  title: string
  subtitle?: string
  columns: number
  showFlows: boolean
  handDrawnFlows: boolean
  pages: ArtboardPage[]
  boards: ArtboardBoard[]
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
