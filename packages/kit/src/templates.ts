import {
  type ArtboardData,
  ArtboardLayoutGuidesSchema,
  ArtboardPrintLayoutSchema,
  type CheckDiagnostic,
  parseArtboard,
  type Verdict,
} from '@akasha/protocol'
import { DATA_STORY_TEMPLATE } from './data-story.js'
import { PR_WALKTHROUGH_TEMPLATE } from './pr-walkthrough.js'
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

/**
 * 步骤状态：`pending` 待执行；`running` 进行中；`done` 已完成；
 * `failed` 失败；`skipped` 跳过。
 */
export type TimelineStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

/** 时间线里的一个步骤；`id` 用来匹配状态流里的 `stepOverrides`。 */
export interface LiveTimelineStep {
  id: string
  title: string
  status: TimelineStepStatus
  detail?: string
  /** 耗时，单位毫秒。 */
  durationMs?: number
  /** 命令的原始输出。 */
  output?: string
  timestamp?: string
}

/** `live-timeline` 模板的数据。 */
export interface LiveTimelineData {
  title: string
  subtitle?: string
  /** 是否展开步骤的原始输出。 */
  showOutputs: boolean
  filterStatus: 'all' | TimelineStepStatus
  /** 可被状态流里的 `steps` 数组整体替换。 */
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

/**
 * 把状态流的实时覆盖合入时间线数据。
 *
 * @remarks 三种覆盖：`steps` 整体替换步骤数组，`stepOverrides[<id>]` 修改单个步骤，
 * `props` 覆盖标题、展开开关与筛选状态。类型不合法的覆盖项被忽略；
 * `steps` 替换后解析失败时保留原步骤。
 */
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

/** 对比的一个维度；源码里可以直接写字符串，此时 `id` 与 `label` 相同。 */
export interface CompareDimension {
  id: string
  label: string
}

/** 对比矩阵里的一个方案。 */
export interface CompareOption {
  id: string
  title: string
  summary?: string
  recommended?: boolean
  pros?: string[]
  cons?: string[]
  /** 各维度的取值；不做维度校验，原样保留。 */
  values?: Record<string, string>
  tags?: string[]
}

/** `option-compare` 模板的数据。 */
export interface OptionCompareData {
  title: string
  summary?: string
  /** 推荐方案的 `id`；取顶层的 `recommended`，没有则取第一个标了 `recommended` 的方案。 */
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

/** 解析 `option-compare` 源码；`options` 必须是数组，其中每项必须有 `title`。 */
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

export const ARTBOARD_TEMPLATE: KitTemplateDefinition<ArtboardData> = {
  type: 'artboard',
  title: '并排多画板（Artboard）',
  description: '同一画布并排对比多套页面/交互方案，支持推荐角标、分轮单选与页面流程连线。',
  guide:
    'JSON 格式定义：pages 用稳定 id 分组；页面的 includeSharedBoards 为 false 时不显示未分组画板。boards 含唯一稳定 id、title、html/description，可选 pageId、viewport（width/height 均为 1–8192 的整数）、position（画布绝对坐标 x/y，单位 CSS 像素）、layoutGroup（布局组合，不参与评审）与 recommended；flows 定义 { from, to, label }。每板可声明 designLayers，按从下到上排列，每层含画板内唯一 id、kind、相对板内的 x/y、width/height，可选 layoutGroup 和 color（ink/blue/rose/amber/mint）。text/note 还需要 text，rectangle/ellipse 只需几何，stroke 还需 2–2048 个按边界归一化为 0–1 的 [x, y] 采样。不要用 designLayers 取代网页的 DOM 或交互逻辑。' +
    '\n每板的 appearance 可指定 background（六位 #RRGGBB）和 cornerRadius（0–8192 整数 CSS 像素）。' +
    'printLayout 缺省或 {mode:"fixed"} 时按画板尺寸输出单页；{mode:"flow",paper:"a4"或"letter"} 按纸型分页。' +
    'layoutGuides 为 {axis:"x"或"y",position:数值} 数组，分别从左或从上量取 0–8192 CSS 像素；同轴位置不得重复。辅助线不参与导出。' +
    'tweaks 最多 32 项；每项包含板内唯一 id（小写字母开头，可含小写字母、数字及连字符）、label、可选 labels（语言标签到文案）及 default。' +
    'type 为 number 时必填 min/max；enum 使用 options: [{ value, label, labels? }]，value 是稳定单词，default 必须为其中一项；boolean 用 true/false；color 用六位 #RRGGBB。' +
    '在当前板的 HTML 样式中以 var(--akasha-tweak-<id>) 消费该值；数值无单位，布尔为 1 或 0。' +
    '界面覆写只预览当前画板，不写入版本或整份模板状态流；固定快照及导出使用源码默认值。' +
    '\n每板可用 presentation: { animation?: boolean, interactive?: boolean } 单独声明循环动效与交互。两个字段可同时为 true；false 明确关闭该能力，省略时由旧稿的实际动效或控件决定。' +
    '原型用 flows 与 data-ak-next 声明跳转；原生表单、详情折叠和输入控件可在试玩时操作。普通按钮图案或音频不构成试玩。' +
    'CSS 关键帧和内联 SVG 可在可见总览循环，无需脚本；GIF/APNG 总览只显示静帧。音视频仅用内嵌媒体，进入试玩后也须手动播放。',
  example: JSON.stringify(
    {
      title: '结账页布局探索',
      columns: 2,
      boards: [
        {
          id: 'opt-a',
          title: '方案 A · 双栏摘要',
          viewport: { width: 1280, height: 800 },
          appearance: { background: '#f6f7f8', cornerRadius: 12 },
          tweaks: [
            {
              id: 'accent',
              type: 'color',
              label: '强调色',
              labels: { en: 'Accent color' },
              default: '#23415e',
            },
          ],
          html: '<div class="p-4 rounded-lg border" style="border-color: var(--akasha-tweak-accent)">左侧表单 / 右侧价格卡片</div>',
          designLayers: [
            {
              id: 'price-note',
              kind: 'note',
              x: 56,
              y: 72,
              width: 200,
              height: 96,
              text: '确认价格信息的阅读顺序',
            },
          ],
        },
        {
          id: 'opt-b',
          title: '方案 B · 分步引导',
          viewport: { width: 390, height: 844 },
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
    {
      boards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            printLayout: ArtboardPrintLayoutSchema.toJSONSchema(),
            layoutGuides: { ...ArtboardLayoutGuidesSchema.toJSONSchema(), uniqueItems: true },
          },
        },
      },
      flows: { type: 'array' },
      groups: { type: 'array' },
    },
    ARTBOARD_PROP_FIELDS,
  ),
  parse: parseArtboard,
  validate(source) {
    const parsed = parseArtboard(source)
    if (!parsed.ok) {
      return [{ severity: 'error', code: 'INVALID_KIT_SOURCE', message: parsed.error }]
    }
    const diags = [
      ...checkUniqueIds(parsed.data.pages, 'artboard.pages'),
      ...checkUniqueIds(parsed.data.boards, 'artboard.boards'),
    ]

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

/** 文档里的行内 Agent 提问。 */
export interface DocumentQuestion {
  id: string
  prompt: string
  /** `open` 待回答；`answered` 已回答。 */
  status: 'open' | 'answered'
  answer?: string
}

export interface DocumentParagraph {
  id: string
  text: string
}

/** 文档的一节；`id` 即该节的稳定块标识。 */
export interface DocumentSection {
  id: string
  heading: string
  level: 1 | 2 | 3
  paragraphs: DocumentParagraph[]
  questions: DocumentQuestion[]
}

/** JSON 格式的结构化文档。 */
export interface StructuredDocumentData {
  format: 'json'
  title: string
  subtitle?: string
  density: 'comfortable' | 'compact'
  showQuestions: boolean
  sections: DocumentSection[]
}

/** HTML 格式的文档；`id` 或 `data-ak-block` 属性充当稳定块标识。 */
export interface HtmlDocumentData {
  format: 'html'
  html: string
}

/** `document` 模板的数据；`format` 区分 JSON 与 HTML 两种源码形态。 */
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

/** 解析 `document` 源码：以 `{` 开头按 JSON 解析，其余按 HTML 原样保留。 */
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

/**
 * 声明状态：`checked` 已验证；`failed` 验证失败；
 * `updated` 修复后待重验；`pending` 待验证。
 */
export type VerifyClaimStatus = 'checked' | 'failed' | 'updated' | 'pending'

/** 预期界面与实际界面的并排对比。 */
export interface VerifyScreenComparison {
  id: string
  title: string
  expectedLabel: string
  actualLabel: string
  /** 预期界面的 HTML 片段。 */
  expectedHtml?: string
  /** 实际界面的 HTML 片段。 */
  actualHtml?: string
  diffNote?: string
}

/** 一条可验证的声明；`id` 用来匹配状态流里的 `claimOverrides` 与 `verdicts`。 */
export interface VerifyClaim {
  id: string
  title: string
  status: VerifyClaimStatus
  summary?: string
  /** 产出证据的命令。 */
  command?: string
  /** 命令的原始输出。 */
  evidence?: string
  verdict?: Verdict
  updatedAt?: string
}

/** 未验证项及其原因。 */
export interface VerifyUnverifiedItem {
  id: string
  title: string
  reason: string
  risk: 'low' | 'medium' | 'high'
}

/** `verify` 模板的数据。 */
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

/**
 * 把状态流的实时覆盖合入验收数据。
 *
 * @remarks `claimOverrides[<id>]` 更新单条声明的状态、证据、摘要与时间，
 * `verdicts[<id>]` 写入裁决，`props` 覆盖未验证项的展示开关与筛选状态。
 * 类型不合法的覆盖项被忽略；`verdicts` 优先于 `claimOverrides` 里的 `verdict`。
 */
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

/** 向注册中心登记全部内置模板；重复调用无效果。 */
export function registerBuiltinKitTemplates(): void {
  if (builtinsRegistered) return
  builtinsRegistered = true
  registerKitTemplate(LIVE_TIMELINE_TEMPLATE)
  registerKitTemplate(OPTION_COMPARE_TEMPLATE)
  registerKitTemplate(ARTBOARD_TEMPLATE)
  registerKitTemplate(DOCUMENT_TEMPLATE)
  registerKitTemplate(VERIFY_TEMPLATE)
  registerKitTemplate(PR_WALKTHROUGH_TEMPLATE)
  registerKitTemplate(DATA_STORY_TEMPLATE)
}
