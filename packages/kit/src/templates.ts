import type { CheckDiagnostic, Verdict } from '@akasha/protocol'
import {
  buildPropsJsonSchema,
  type KitParseResult,
  type KitPropField,
  type KitTemplateDefinition,
  registerKitTemplate,
} from './registry.js'

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((item): item is string => typeof item === 'string')
}

function parseJsonObject(source: string): KitParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(source) as unknown
    const rec = asRecord(parsed)
    if (!rec) return { ok: false, error: '模板源码必须为 JSON 对象' }
    return { ok: true, data: rec }
  } catch (err) {
    return {
      ok: false,
      error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function checkUniqueIds(
  items: readonly { id: string }[],
  label: string,
  code = 'DUPLICATE_BLOCK_ID',
): CheckDiagnostic[] {
  const seen = new Set<string>()
  const out: CheckDiagnostic[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      out.push({
        severity: 'error',
        code,
        message: `${label} 存在重复的 id "${item.id}"`,
        suggestion: '请确保每个条目的 id 唯一且稳定',
      })
    } else {
      seen.add(item.id)
    }
  }
  return out
}

// ============================================================================
// 1. live-timeline（实时排障与任务进度看板）
// ============================================================================

export type TimelineStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface LiveTimelineStep {
  id: string
  title: string
  status: TimelineStepStatus
  detail?: string
  durationMs?: number
  output?: string
  timestamp?: string
}

export interface LiveTimelineData {
  title: string
  subtitle?: string
  showOutputs: boolean
  filterStatus: 'all' | TimelineStepStatus
  steps: LiveTimelineStep[]
}

const VALID_STEP_STATUS = new Set<TimelineStepStatus>([
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
])

export const LIVE_TIMELINE_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'title',
    label: '看板标题',
    type: 'string',
    defaultValue: '任务执行时间线',
  },
  {
    key: 'filterStatus',
    label: '状态筛选',
    type: 'select',
    defaultValue: 'all',
    options: [
      { value: 'all', label: '全部步骤' },
      { value: 'running', label: '进行中' },
      { value: 'failed', label: '失败项' },
      { value: 'done', label: '已完成' },
      { value: 'pending', label: '待执行' },
    ],
  },
  {
    key: 'showOutputs',
    label: '展开原始输出日志',
    type: 'boolean',
    defaultValue: true,
  },
]

export function parseLiveTimeline(source: string): KitParseResult<LiveTimelineData> {
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawSteps = res.data.steps
  if (!Array.isArray(rawSteps)) {
    return { ok: false, error: 'live-timeline 缺少数组字段 "steps"' }
  }
  const steps: LiveTimelineStep[] = []
  for (let i = 0; i < rawSteps.length; i++) {
    const rec = asRecord(rawSteps[i])
    if (!rec) return { ok: false, error: `steps[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `step-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `steps[${i}] 缺少 title` }
    const rawStatus = asString(rec.status) as TimelineStepStatus | undefined
    const status: TimelineStepStatus =
      rawStatus && VALID_STEP_STATUS.has(rawStatus) ? rawStatus : 'pending'
    steps.push({
      id,
      title,
      status,
      detail: asString(rec.detail),
      durationMs: asNumber(rec.durationMs),
      output: asString(rec.output),
      timestamp: asString(rec.timestamp),
    })
  }
  const filterRaw = asString(res.data.filterStatus)
  const filterStatus =
    filterRaw === 'all' || (filterRaw && VALID_STEP_STATUS.has(filterRaw as TimelineStepStatus))
      ? (filterRaw as LiveTimelineData['filterStatus'])
      : 'all'

  return {
    ok: true,
    data: {
      title: asString(res.data.title) ?? '任务执行时间线',
      subtitle: asString(res.data.subtitle),
      showOutputs: asBoolean(res.data.showOutputs) ?? true,
      filterStatus,
      steps,
    },
  }
}

// 将 StateStream 的实时状态覆盖（steps 数组或 stepOverrides[id]）合入时间线步骤，实现零重挂实时推进。
export function applyLiveTimelineState(
  base: LiveTimelineData,
  stateSnapshot: Record<string, unknown> | undefined,
): LiveTimelineData {
  if (!stateSnapshot) return base
  const propsOverlay = asRecord(stateSnapshot.props)
  const stepOverrides = asRecord(stateSnapshot.stepOverrides)
  const replacedSteps = Array.isArray(stateSnapshot.steps) ? stateSnapshot.steps : undefined

  let steps = base.steps
  if (replacedSteps) {
    const parsed = parseLiveTimeline(JSON.stringify({ ...base, steps: replacedSteps }))
    if (parsed.ok) steps = parsed.data.steps
  }
  if (stepOverrides) {
    steps = steps.map((step) => {
      const patch = asRecord(stepOverrides[step.id])
      if (!patch) return step
      const rawStatus = asString(patch.status) as TimelineStepStatus | undefined
      return {
        ...step,
        ...(asString(patch.title) ? { title: asString(patch.title) } : {}),
        ...(rawStatus && VALID_STEP_STATUS.has(rawStatus) ? { status: rawStatus } : {}),
        ...(asString(patch.detail) !== undefined ? { detail: asString(patch.detail) } : {}),
        ...(asNumber(patch.durationMs) !== undefined
          ? { durationMs: asNumber(patch.durationMs) }
          : {}),
        ...(asString(patch.output) !== undefined ? { output: asString(patch.output) } : {}),
      }
    })
  }

  return {
    ...base,
    title: asString(propsOverlay?.title) ?? base.title,
    showOutputs: asBoolean(propsOverlay?.showOutputs) ?? base.showOutputs,
    filterStatus:
      (asString(propsOverlay?.filterStatus) as LiveTimelineData['filterStatus'] | undefined) ??
      base.filterStatus,
    steps,
  }
}

export const LIVE_TIMELINE_TEMPLATE: KitTemplateDefinition<LiveTimelineData> = {
  type: 'live-timeline',
  title: '实时执行时间线',
  description: '展示多步任务执行进度、耗时与命令输出，支持 artifact_push_state 零闪烁推进。',
  guide:
    'JSON 格式实时任务/排障时间线：包含 title 与 steps，运行期间优先用 artifact_push_state 更新 stepOverrides.<id> 或 props 增量推进步骤状态。',
  example: JSON.stringify(
    {
      title: '发布流水线排障',
      subtitle: '分支 feat/release-check',
      showOutputs: true,
      steps: [
        { id: 'install', title: '安装依赖', status: 'done', durationMs: 1200 },
        {
          id: 'test',
          title: '运行单元测试',
          status: 'running',
          detail: '执行 vitest run',
          output: '13 passed (13)',
        },
        { id: 'build', title: '构建产物', status: 'pending' },
      ],
    },
    null,
    2,
  ),
  propFields: LIVE_TIMELINE_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema(
    ['steps'],
    { steps: { type: 'array' } },
    LIVE_TIMELINE_PROP_FIELDS,
  ),
  parse: parseLiveTimeline,
  validate(source) {
    const parsed = parseLiveTimeline(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    const diags = checkUniqueIds(parsed.data.steps, 'live-timeline.steps')
    if (parsed.data.steps.length === 0) {
      diags.push({
        severity: 'warning',
        code: 'EMPTY_TIMELINE_STEPS',
        message: 'live-timeline 的 steps 为空数组',
      })
    }
    return diags
  },
}

// ============================================================================
// 2. option-compare（结构化多方案对比矩阵）
// ============================================================================

export interface CompareDimension {
  id: string
  label: string
}

export interface CompareOption {
  id: string
  title: string
  summary?: string
  recommended?: boolean
  pros?: string[]
  cons?: string[]
  values?: Record<string, string>
  tags?: string[]
}

export interface OptionCompareData {
  title: string
  summary?: string
  recommended?: string
  highlightDiffs: boolean
  compact: boolean
  dimensions: CompareDimension[]
  options: CompareOption[]
}

export const OPTION_COMPARE_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'title',
    label: '对比标题',
    type: 'string',
    defaultValue: '架构方案对比',
  },
  {
    key: 'highlightDiffs',
    label: '高亮差异维度',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'compact',
    label: '紧凑视图',
    type: 'boolean',
    defaultValue: false,
  },
]

export function parseOptionCompare(source: string): KitParseResult<OptionCompareData> {
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawOptions = res.data.options
  if (!Array.isArray(rawOptions)) {
    return { ok: false, error: 'option-compare 缺少数组字段 "options"' }
  }
  const dimensions: CompareDimension[] = []
  if (Array.isArray(res.data.dimensions)) {
    for (let i = 0; i < res.data.dimensions.length; i++) {
      const item = res.data.dimensions[i]
      if (typeof item === 'string') {
        dimensions.push({ id: item, label: item })
      } else {
        const rec = asRecord(item)
        if (rec) {
          const id = asString(rec.id)?.trim() || `dim-${i + 1}`
          const label = asString(rec.label)?.trim() || id
          dimensions.push({ id, label })
        }
      }
    }
  }

  const options: CompareOption[] = []
  for (let i = 0; i < rawOptions.length; i++) {
    const rec = asRecord(rawOptions[i])
    if (!rec) return { ok: false, error: `options[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `opt-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `options[${i}] 缺少 title` }
    const valuesRec = asRecord(rec.values)
    const values: Record<string, string> | undefined = valuesRec
      ? Object.fromEntries(
          Object.entries(valuesRec).map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
        )
      : undefined
    options.push({
      id,
      title,
      summary: asString(rec.summary),
      recommended: asBoolean(rec.recommended),
      pros: asStringArray(rec.pros),
      cons: asStringArray(rec.cons),
      values,
      tags: asStringArray(rec.tags),
    })
  }

  const topRecommended = asString(res.data.recommended) ?? options.find((o) => o.recommended)?.id

  return {
    ok: true,
    data: {
      title: asString(res.data.title) ?? '架构方案对比',
      summary: asString(res.data.summary),
      recommended: topRecommended,
      highlightDiffs: asBoolean(res.data.highlightDiffs) ?? true,
      compact: asBoolean(res.data.compact) ?? false,
      dimensions,
      options,
    },
  }
}

export const OPTION_COMPARE_TEMPLATE: KitTemplateDefinition<OptionCompareData> = {
  type: 'option-compare',
  title: '多方案对比矩阵',
  description: '结构化并排展示多个技术或设计方案的优缺点、评分维度与推荐标记。',
  guide:
    'JSON 格式多方案对比矩阵：包含 dimensions 与 options（每项带唯一 id 与 title，可选 recommended/pros/cons/values）。',
  example: JSON.stringify(
    {
      title: '本地存储方案对比',
      recommended: 'sqlite',
      dimensions: [
        { id: 'zeroDep', label: '零外部依赖' },
        { id: 'gitFriendly', label: 'Git 友好' },
      ],
      options: [
        {
          id: 'sqlite',
          title: '内置 SQLite',
          recommended: true,
          pros: ['单文件零配置', '全文检索快'],
          cons: ['二进制不可直接 diff'],
          values: { zeroDep: 'Node 24 原生', gitFriendly: '需导出' },
        },
        {
          id: 'fs',
          title: '.artifacts 文件目录',
          pros: ['天然可入 Git', '宿主原生编辑'],
          cons: ['需要文件监听同步'],
          values: { zeroDep: '原生 FS', gitFriendly: '极佳' },
        },
      ],
    },
    null,
    2,
  ),
  propFields: OPTION_COMPARE_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema(
    ['options'],
    { options: { type: 'array' }, dimensions: { type: 'array' } },
    OPTION_COMPARE_PROP_FIELDS,
  ),
  parse: parseOptionCompare,
  validate(source) {
    const parsed = parseOptionCompare(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    const diags = checkUniqueIds(parsed.data.options, 'option-compare.options')
    const optionIds = new Set(parsed.data.options.map((o) => o.id))
    if (parsed.data.recommended && !optionIds.has(parsed.data.recommended)) {
      diags.push({
        severity: 'warning',
        code: 'UNKNOWN_RECOMMENDED_OPTION',
        message: `推荐方案 "${parsed.data.recommended}" 未在 options 中定义`,
      })
    }
    return diags
  },
}

// ============================================================================
// 3. artboard（并排多画板与页面流程连线）
// ============================================================================

export interface ArtboardPage {
  id: string
  title: string
}

export interface ArtboardBoard {
  id: string
  title: string
  subtitle?: string
  pageId?: string
  groupId?: string
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

export const ARTBOARD_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'columns',
    label: '每行画板列数',
    type: 'number',
    defaultValue: 2,
    min: 1,
    max: 4,
    step: 1,
  },
  {
    key: 'showFlows',
    label: '显示页面流程连线',
    type: 'boolean',
    defaultValue: true,
  },
  {
    key: 'handDrawnFlows',
    label: '手绘风格连线（Inkline）',
    type: 'boolean',
    defaultValue: true,
  },
]

export function parseArtboard(source: string): KitParseResult<ArtboardData> {
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawBoards = res.data.boards
  if (!Array.isArray(rawBoards)) {
    return { ok: false, error: 'artboard 缺少数组字段 "boards"' }
  }

  const pages: ArtboardPage[] = []
  if (Array.isArray(res.data.pages)) {
    for (let i = 0; i < res.data.pages.length; i++) {
      const rec = asRecord(res.data.pages[i])
      if (!rec) continue
      const id = asString(rec.id)?.trim() || `page-${i + 1}`
      pages.push({ id, title: asString(rec.title)?.trim() || id })
    }
  }

  const boards: ArtboardBoard[] = []
  for (let i = 0; i < rawBoards.length; i++) {
    const rec = asRecord(rawBoards[i])
    if (!rec) return { ok: false, error: `boards[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `board-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `boards[${i}] 缺少 title` }
    boards.push({
      id,
      title,
      subtitle: asString(rec.subtitle),
      pageId: asString(rec.pageId),
      groupId: asString(rec.groupId),
      recommended: asBoolean(rec.recommended),
      html: asString(rec.html),
      description: asString(rec.description),
      tags: asStringArray(rec.tags),
    })
  }

  const flows: ArtboardFlow[] = []
  if (Array.isArray(res.data.flows)) {
    for (const item of res.data.flows) {
      const rec = asRecord(item)
      if (!rec) continue
      const from = asString(rec.from)?.trim()
      const to = asString(rec.to)?.trim()
      if (from && to) {
        flows.push({ from, to, label: asString(rec.label) })
      }
    }
  }

  const rawCols = asNumber(res.data.columns)
  const columns = rawCols
    ? Math.min(4, Math.max(1, Math.round(rawCols)))
    : Math.min(2, Math.max(1, boards.length))

  return {
    ok: true,
    data: {
      title: asString(res.data.title) ?? '并排方案画板',
      subtitle: asString(res.data.subtitle),
      columns,
      showFlows: asBoolean(res.data.showFlows) ?? true,
      handDrawnFlows: asBoolean(res.data.handDrawnFlows) ?? true,
      pages,
      boards,
      flows,
    },
  }
}

export const ARTBOARD_TEMPLATE: KitTemplateDefinition<ArtboardData> = {
  type: 'artboard',
  title: '并排多画板（Artboard）',
  description: '同一画布并排对比多套页面/交互方案，支持推荐角标、分轮单选与页面流程连线。',
  guide:
    'JSON 格式并排多画板定义：包含 boards（含唯一 id、title、html/description、可选 recommended）、可选 pages、flows（{ from, to, label }）与 groups。',
  example: JSON.stringify(
    {
      title: '结账页布局探索',
      columns: 2,
      boards: [
        {
          id: 'opt-a',
          title: '方案 A · 双栏摘要',
          html: '<div class="p-4 rounded-lg border">左侧表单 / 右侧价格卡片</div>',
        },
        {
          id: 'opt-b',
          title: '方案 B · 分步引导',
          recommended: true,
          html: '<div class="p-4 rounded-lg border bg-violet-50">三步清晰结账流程</div>',
        },
      ],
      flows: [{ from: 'opt-a', to: 'opt-b', label: '推荐演进' }],
    },
    null,
    2,
  ),
  propFields: ARTBOARD_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema(
    ['boards'],
    { boards: { type: 'array' }, flows: { type: 'array' }, groups: { type: 'array' } },
    ARTBOARD_PROP_FIELDS,
  ),
  parse: parseArtboard,
  validate(source) {
    const parsed = parseArtboard(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    const diags = checkUniqueIds(parsed.data.boards, 'artboard.boards')
    const boardIds = new Set(parsed.data.boards.map((b) => b.id))
    for (const flow of parsed.data.flows) {
      if (!boardIds.has(flow.from) || !boardIds.has(flow.to)) {
        diags.push({
          severity: 'warning',
          code: 'UNKNOWN_FLOW_ENDPOINT',
          message: `流程连线 "${flow.from} -> ${flow.to}" 引用了未定义的画板 id`,
        })
      }
    }
    return diags
  },
}

// ============================================================================
// 4. document（结构化设计文档：支持稳定 blockId JSON 与 HTML 双格式）
// ============================================================================

export interface DocumentQuestion {
  id: string
  prompt: string
  status: 'open' | 'answered'
  answer?: string
}

export interface DocumentParagraph {
  id: string
  text: string
}

export interface DocumentSection {
  id: string
  heading: string
  level: 1 | 2 | 3
  paragraphs: DocumentParagraph[]
  questions: DocumentQuestion[]
}

export interface StructuredDocumentData {
  format: 'json'
  title: string
  subtitle?: string
  density: 'comfortable' | 'compact'
  showQuestions: boolean
  sections: DocumentSection[]
}

export interface HtmlDocumentData {
  format: 'html'
  html: string
}

export type DocumentData = StructuredDocumentData | HtmlDocumentData

export const DOCUMENT_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'density',
    label: '排版密度',
    type: 'select',
    defaultValue: 'comfortable',
    options: [
      { value: 'comfortable', label: '舒适阅读' },
      { value: 'compact', label: '紧凑评审' },
    ],
  },
  {
    key: 'showQuestions',
    label: '显示行内 Agent 提问',
    type: 'boolean',
    defaultValue: true,
  },
]

export function parseDocument(source: string): KitParseResult<DocumentData> {
  const trimmed = source.trim()
  if (!trimmed.startsWith('{')) {
    return { ok: true, data: { format: 'html', html: source } }
  }
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawSections = res.data.sections
  if (!Array.isArray(rawSections)) {
    return { ok: false, error: 'JSON 格式 document 缺少数组字段 "sections"' }
  }
  const sections: DocumentSection[] = []
  for (let i = 0; i < rawSections.length; i++) {
    const rec = asRecord(rawSections[i])
    if (!rec) return { ok: false, error: `sections[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `sec-${i + 1}`
    const heading = asString(rec.heading)?.trim() || `章节 ${i + 1}`
    const rawLevel = asNumber(rec.level)
    const level: 1 | 2 | 3 = rawLevel === 1 || rawLevel === 3 ? rawLevel : 2

    const paragraphs: DocumentParagraph[] = []
    if (Array.isArray(rec.paragraphs)) {
      for (let j = 0; j < rec.paragraphs.length; j++) {
        const p = rec.paragraphs[j]
        if (typeof p === 'string') {
          paragraphs.push({ id: `${id}-p${j + 1}`, text: p })
        } else {
          const pRec = asRecord(p)
          if (pRec) {
            paragraphs.push({
              id: asString(pRec.id)?.trim() || `${id}-p${j + 1}`,
              text: asString(pRec.text) ?? '',
            })
          }
        }
      }
    } else if (typeof rec.body === 'string' && rec.body.trim()) {
      paragraphs.push({ id: `${id}-body`, text: rec.body })
    }

    const questions: DocumentQuestion[] = []
    if (Array.isArray(rec.questions)) {
      for (let q = 0; q < rec.questions.length; q++) {
        const qRec = asRecord(rec.questions[q])
        if (!qRec) continue
        const prompt = asString(qRec.prompt)?.trim()
        if (!prompt) continue
        questions.push({
          id: asString(qRec.id)?.trim() || `${id}-q${q + 1}`,
          prompt,
          status: asString(qRec.status) === 'answered' ? 'answered' : 'open',
          answer: asString(qRec.answer),
        })
      }
    }

    sections.push({ id, heading, level, paragraphs, questions })
  }

  return {
    ok: true,
    data: {
      format: 'json',
      title: asString(res.data.title) ?? '设计文档',
      subtitle: asString(res.data.subtitle),
      density: asString(res.data.density) === 'compact' ? 'compact' : 'comfortable',
      showQuestions: asBoolean(res.data.showQuestions) ?? true,
      sections,
    },
  }
}

export const DOCUMENT_TEMPLATE: KitTemplateDefinition<DocumentData> = {
  type: 'document',
  title: '结构化设计文档',
  description: '段落与标题带稳定 blockId，支持句级批注、行内 Agent 提问与人工改稿差异追踪。',
  guide:
    '支持带稳定 id/data-ak-block 的 HTML 或结构化 JSON（{ title, sections: [{ id, heading, paragraphs: [{ id, text }], questions }] }），确保增删行后批注仍能稳定锚定。',
  example: JSON.stringify(
    {
      title: '重试与熔断策略 PRD',
      subtitle: 'v1 评审稿',
      sections: [
        {
          id: 'goal',
          heading: '1. 核心目标',
          paragraphs: [
            { id: 'p-timeout', text: '外部支付接口超时阈值统一收敛为 3 秒并启用指数退避。' },
          ],
          questions: [
            { id: 'q-retry', prompt: '幂等键冲突时是否允许客户端自动重试？', status: 'open' },
          ],
        },
      ],
    },
    null,
    2,
  ),
  propFields: DOCUMENT_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema([], { sections: { type: 'array' } }, DOCUMENT_PROP_FIELDS),
  parse: parseDocument,
  validate(source) {
    const parsed = parseDocument(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    if (parsed.data.format === 'html') return []
    const allIds: Array<{ id: string }> = []
    for (const sec of parsed.data.sections) {
      allIds.push({ id: sec.id })
      for (const p of sec.paragraphs) allIds.push({ id: p.id })
      for (const q of sec.questions) allIds.push({ id: q.id })
    }
    return checkUniqueIds(allIds, 'document blocks')
  },
}

// ============================================================================
// 5. verify（交付验收：预期/实际并排对比 + 可验证声明证据 + 未验证项清单）
// ============================================================================

export type VerifyClaimStatus = 'checked' | 'failed' | 'updated' | 'pending'

export interface VerifyScreenComparison {
  id: string
  title: string
  expectedLabel: string
  actualLabel: string
  expectedHtml?: string
  actualHtml?: string
  diffNote?: string
}

export interface VerifyClaim {
  id: string
  title: string
  status: VerifyClaimStatus
  summary?: string
  command?: string
  evidence?: string
  verdict?: Verdict
  updatedAt?: string
}

export interface VerifyUnverifiedItem {
  id: string
  title: string
  reason: string
  risk: 'low' | 'medium' | 'high'
}

export interface VerifyData {
  title: string
  summary?: string
  showUnverified: boolean
  filterStatus: 'all' | VerifyClaimStatus
  screens: VerifyScreenComparison[]
  claims: VerifyClaim[]
  unverified: VerifyUnverifiedItem[]
}

const VALID_CLAIM_STATUS = new Set<VerifyClaimStatus>(['checked', 'failed', 'updated', 'pending'])
const VALID_VERDICTS = new Set<Verdict>(['pass', 'reject', 'waive'])

export const VERIFY_PROP_FIELDS: readonly KitPropField[] = [
  {
    key: 'filterStatus',
    label: '声明状态筛选',
    type: 'select',
    defaultValue: 'all',
    options: [
      { value: 'all', label: '全部声明' },
      { value: 'checked', label: '已验证' },
      { value: 'updated', label: '修复待重验' },
      { value: 'failed', label: '验证失败' },
      { value: 'pending', label: '待验证' },
    ],
  },
  {
    key: 'showUnverified',
    label: '展示未验证项清单',
    type: 'boolean',
    defaultValue: true,
  },
]

export function parseVerify(source: string): KitParseResult<VerifyData> {
  const res = parseJsonObject(source)
  if (!res.ok) return res
  const rawClaims = res.data.claims
  if (!Array.isArray(rawClaims)) {
    return { ok: false, error: 'verify 缺少数组字段 "claims"' }
  }

  const screens: VerifyScreenComparison[] = []
  if (Array.isArray(res.data.screens)) {
    for (let i = 0; i < res.data.screens.length; i++) {
      const rec = asRecord(res.data.screens[i])
      if (!rec) continue
      screens.push({
        id: asString(rec.id)?.trim() || `screen-${i + 1}`,
        title: asString(rec.title)?.trim() || `对比画面 ${i + 1}`,
        expectedLabel: asString(rec.expectedLabel) ?? '批准设计稿 / 预期',
        actualLabel: asString(rec.actualLabel) ?? '实际构建结果',
        expectedHtml: asString(rec.expectedHtml),
        actualHtml: asString(rec.actualHtml),
        diffNote: asString(rec.diffNote),
      })
    }
  }

  const claims: VerifyClaim[] = []
  for (let i = 0; i < rawClaims.length; i++) {
    const rec = asRecord(rawClaims[i])
    if (!rec) return { ok: false, error: `claims[${i}] 必须为对象` }
    const id = asString(rec.id)?.trim() || `claim-${i + 1}`
    const title = asString(rec.title)?.trim()
    if (!title) return { ok: false, error: `claims[${i}] 缺少 title` }
    const rawStatus = asString(rec.status) as VerifyClaimStatus | undefined
    const rawVerdict = asString(rec.verdict) as Verdict | undefined
    claims.push({
      id,
      title,
      status: rawStatus && VALID_CLAIM_STATUS.has(rawStatus) ? rawStatus : 'checked',
      summary: asString(rec.summary),
      command: asString(rec.command),
      evidence: asString(rec.evidence),
      verdict: rawVerdict && VALID_VERDICTS.has(rawVerdict) ? rawVerdict : undefined,
      updatedAt: asString(rec.updatedAt),
    })
  }

  const unverified: VerifyUnverifiedItem[] = []
  if (Array.isArray(res.data.unverified)) {
    for (let i = 0; i < res.data.unverified.length; i++) {
      const rec = asRecord(res.data.unverified[i])
      if (!rec) continue
      const title = asString(rec.title)?.trim()
      if (!title) continue
      const riskRaw = asString(rec.risk)
      unverified.push({
        id: asString(rec.id)?.trim() || `unverified-${i + 1}`,
        title,
        reason: asString(rec.reason) ?? '尚未执行验证',
        risk: riskRaw === 'high' || riskRaw === 'low' ? riskRaw : 'medium',
      })
    }
  }

  const filterRaw = asString(res.data.filterStatus)
  const filterStatus =
    filterRaw === 'all' || (filterRaw && VALID_CLAIM_STATUS.has(filterRaw as VerifyClaimStatus))
      ? (filterRaw as VerifyData['filterStatus'])
      : 'all'

  return {
    ok: true,
    data: {
      title: asString(res.data.title) ?? '交付验收报告',
      summary: asString(res.data.summary),
      showUnverified: asBoolean(res.data.showUnverified) ?? true,
      filterStatus,
      screens,
      claims,
      unverified,
    },
  }
}

// 合入 StateStream 实时重验证据更新（claimOverrides[id]）与裁决状态（verdicts[id]）
export function applyVerifyState(
  base: VerifyData,
  stateSnapshot: Record<string, unknown> | undefined,
): VerifyData {
  if (!stateSnapshot) return base
  const propsOverlay = asRecord(stateSnapshot.props)
  const claimOverrides = asRecord(stateSnapshot.claimOverrides)
  const verdicts = asRecord(stateSnapshot.verdicts)

  const claims = base.claims.map((c) => {
    const patch = asRecord(claimOverrides?.[c.id])
    const verdictRaw = asString(verdicts?.[c.id]) ?? asString(patch?.verdict)
    const statusRaw = asString(patch?.status) as VerifyClaimStatus | undefined
    return {
      ...c,
      ...(statusRaw && VALID_CLAIM_STATUS.has(statusRaw) ? { status: statusRaw } : {}),
      ...(asString(patch?.evidence) !== undefined ? { evidence: asString(patch?.evidence) } : {}),
      ...(asString(patch?.summary) !== undefined ? { summary: asString(patch?.summary) } : {}),
      ...(asString(patch?.updatedAt) !== undefined
        ? { updatedAt: asString(patch?.updatedAt) }
        : {}),
      ...(verdictRaw && VALID_VERDICTS.has(verdictRaw as Verdict)
        ? { verdict: verdictRaw as Verdict }
        : {}),
    }
  })

  return {
    ...base,
    showUnverified: asBoolean(propsOverlay?.showUnverified) ?? base.showUnverified,
    filterStatus:
      (asString(propsOverlay?.filterStatus) as VerifyData['filterStatus'] | undefined) ??
      base.filterStatus,
    claims,
  }
}

export const VERIFY_TEMPLATE: KitTemplateDefinition<VerifyData> = {
  type: 'verify',
  title: '交付验收报告（Verify）',
  description:
    '预期稿与实际构建并排对比、逐条可展开原始证据声明与未验证项清单，支持 Pass/Reject/Waive 裁决与驳回重验。',
  guide:
    'JSON 格式交付验收报告：包含 claims（id、title、status、command、evidence）、unverified（id、title、reason、risk）与可选 screens（expectedHtml、actualHtml）。被驳回项修复后可通过 state.claimOverrides 更新证据并标为 status="updated" 供重验。',
  example: JSON.stringify(
    {
      title: 'M3 交付验收清单',
      screens: [
        {
          id: 'scr-1',
          title: '主工作台布局对比',
          expectedHtml: '<div class="p-3 border rounded">预期：左右分栏 + 底部提交栏</div>',
          actualHtml:
            '<div class="p-3 border rounded bg-emerald-50">实际：左右分栏 + 底部提交栏</div>',
        },
      ],
      claims: [
        {
          id: 'c-unit',
          title: '全部单元与端到端回归通过',
          status: 'checked',
          command: 'make test',
          evidence: '13 passed (59 tests)',
        },
      ],
      unverified: [
        { id: 'u-prod', title: '生产环境冷启动延迟', reason: '尚未发布至云端', risk: 'low' },
      ],
    },
    null,
    2,
  ),
  propFields: VERIFY_PROP_FIELDS,
  propsSchema: buildPropsJsonSchema(
    ['claims'],
    { claims: { type: 'array' }, unverified: { type: 'array' }, screens: { type: 'array' } },
    VERIFY_PROP_FIELDS,
  ),
  parse: parseVerify,
  validate(source) {
    const parsed = parseVerify(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    return [
      ...checkUniqueIds(parsed.data.claims, 'verify.claims'),
      ...checkUniqueIds(parsed.data.screens, 'verify.screens'),
      ...checkUniqueIds(parsed.data.unverified, 'verify.unverified'),
    ]
  },
}

let builtinsRegistered = false

export function registerBuiltinKitTemplates(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  registerKitTemplate(LIVE_TIMELINE_TEMPLATE)
  registerKitTemplate(OPTION_COMPARE_TEMPLATE)
  registerKitTemplate(ARTBOARD_TEMPLATE)
  registerKitTemplate(DOCUMENT_TEMPLATE)
  registerKitTemplate(VERIFY_TEMPLATE)
}
