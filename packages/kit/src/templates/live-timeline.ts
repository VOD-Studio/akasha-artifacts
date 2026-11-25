import {
  buildPropsJsonSchema,
  type KitParseResult,
  type KitPropField,
  type KitTemplateDefinition,
} from '../registry.js'
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  checkUniqueIds,
  parseJsonObject,
} from './source-validation.js'

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
