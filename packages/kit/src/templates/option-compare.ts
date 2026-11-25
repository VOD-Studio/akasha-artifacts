import {
  buildPropsJsonSchema,
  type KitParseResult,
  type KitPropField,
  type KitTemplateDefinition,
} from '../registry.js'
import {
  asBoolean,
  asRecord,
  asString,
  asStringArray,
  checkUniqueIds,
  parseJsonObject,
} from './source-validation.js'

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
