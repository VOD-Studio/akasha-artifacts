import { DATA_POINT_SELECTION_LIMITS } from '@akasha/protocol'
import {
  decisionDiagnostics,
  invalid,
  list,
  object,
  optionalText,
  parseDecision,
  stableId,
  stableIdPattern,
  text,
  uniqueIndex,
} from './decision-validation.js'
import { buildPropsJsonSchema, type KitPropField, type KitTemplateDefinition } from './registry.js'

type StoryValue = string | number

interface StoryColumn {
  id: string
  label: string
  kind: 'text' | 'number'
}

export interface StoryRow {
  id: string
  values: ReadonlyMap<string, StoryValue>
}

interface StoryDataset {
  id: string
  title: string
  filterBy?: StoryColumn
  rows: StoryRow[]
  charts: StoryChart[]
  tables: StoryTable[]
}

export interface StoryChart {
  id: string
  title: string
  category: StoryColumn
  value: StoryColumn
}

export interface StoryTable {
  id: string
  title: string
  columns: StoryColumn[]
}

export interface DataStoryData {
  title: string
  summary?: string
  datasets: StoryDataset[]
}

function storyId(value: unknown, field: string): string {
  const id = stableId(value, field)
  if (id.length > DATA_POINT_SELECTION_LIMITS.id) {
    invalid(field, `不能超过 ${DATA_POINT_SELECTION_LIMITS.id} 个字符`)
  }
  return id
}

function annotationLabel(value: unknown, field: string): string {
  const label = text(value, field)
  if (label.length > DATA_POINT_SELECTION_LIMITS.label) {
    invalid(field, `不能超过 ${DATA_POINT_SELECTION_LIMITS.label} 个字符`)
  }
  return label
}

function parseDataStory(source: string) {
  return parseDecision<DataStoryData>(source, (raw) => {
    const parsedDatasets = list(
      raw.datasets,
      'datasets',
      (item, at) => {
        const value = object(item, at)
        const columns = list(
          value.columns,
          `${at}.columns`,
          (entry, path): StoryColumn => {
            const column = object(entry, path)
            if (column.kind !== 'text' && column.kind !== 'number') {
              invalid(`${path}.kind`, '必须为 text 或 number')
            }
            return {
              id: storyId(column.id, `${path}.id`),
              label: annotationLabel(column.label, `${path}.label`),
              kind: column.kind,
            }
          },
          true,
        )
        const columnIndex = uniqueIndex(columns, (column) => column.id, `${at}.columns`)
        const getColumn = (input: unknown, path: string): StoryColumn => {
          const id = storyId(input, path)
          const column = columnIndex.get(id)
          if (!column) invalid(path, `引用了不存在的列 "${id}"`)
          return column
        }
        let filterBy: StoryColumn | undefined
        if (value.filterBy !== undefined) {
          filterBy = getColumn(value.filterBy, `${at}.filterBy`)
          if (filterBy.kind !== 'text') invalid(`${at}.filterBy`, '必须引用文本列')
        }
        const rows = list(value.rows, `${at}.rows`, (entry, path): StoryRow => {
          const row = object(entry, path)
          const items = object(row.values, `${path}.values`)
          const values = new Map<string, StoryValue>()
          for (const [key, cell] of Object.entries(items)) {
            const column = getColumn(key, `${path}.values`)
            if (column.kind === 'text' && typeof cell === 'string') {
              values.set(key, cell)
            } else if (
              column.kind === 'number' &&
              typeof cell === 'number' &&
              Number.isFinite(cell)
            ) {
              values.set(key, cell)
            } else {
              invalid(
                `${path}.values.${key}`,
                column.kind === 'text' ? '必须为字符串' : '必须为有限数值',
              )
            }
          }
          for (const column of columns) {
            if (!values.has(column.id)) invalid(`${path}.values`, `缺少列 "${column.id}" 的值`)
          }
          return { id: storyId(row.id, `${path}.id`), values }
        })
        uniqueIndex(rows, (row) => row.id, `${at}.rows`)
        const dataset: StoryDataset = {
          id: storyId(value.id, `${at}.id`),
          title: text(value.title, `${at}.title`),
          filterBy,
          rows,
          charts: [],
          tables: [],
        }
        return { dataset, getColumn }
      },
      true,
    )
    const datasetIndex = uniqueIndex(parsedDatasets, (item) => item.dataset.id, 'datasets')
    const getDataset = (value: unknown, at: string) => {
      const id = storyId(value, at)
      const dataset = datasetIndex.get(id)
      if (!dataset) invalid(at, `引用了不存在的数据集 "${id}"`)
      return dataset
    }
    const charts = list(raw.charts === undefined ? [] : raw.charts, 'charts', (item, at) => {
      const chart = object(item, at)
      const { dataset, getColumn } = getDataset(chart.datasetId, `${at}.datasetId`)
      const value = getColumn(chart.value, `${at}.value`)
      if (value.kind !== 'number') invalid(`${at}.value`, '必须引用数值列')
      const category = getColumn(chart.category, `${at}.category`)
      for (const row of dataset.rows) {
        const label = row.values.get(category.id)
        if (typeof label === 'string' && label.length > DATA_POINT_SELECTION_LIMITS.label) {
          invalid(
            `${at}.category`,
            `数据行 "${row.id}" 的图表标签不能超过 ${DATA_POINT_SELECTION_LIMITS.label} 个字符`,
          )
        }
      }
      const parsed: StoryChart = {
        id: storyId(chart.id, `${at}.id`),
        title: annotationLabel(chart.title, `${at}.title`),
        category,
        value,
      }
      dataset.charts.push(parsed)
      return parsed
    })
    uniqueIndex(charts, (chart) => chart.id, 'charts')
    const tables = list(raw.tables === undefined ? [] : raw.tables, 'tables', (item, at) => {
      const table = object(item, at)
      const { dataset, getColumn } = getDataset(table.datasetId, `${at}.datasetId`)
      const columns = list(table.columns, `${at}.columns`, getColumn, true)
      uniqueIndex(columns, (column) => column.id, `${at}.columns`)
      const parsed: StoryTable = {
        id: storyId(table.id, `${at}.id`),
        title: text(table.title, `${at}.title`),
        columns,
      }
      dataset.tables.push(parsed)
      return parsed
    })
    uniqueIndex(tables, (table) => table.id, 'tables')
    const datasets = parsedDatasets.map(({ dataset }) => {
      if (!dataset.charts.length && !dataset.tables.length) {
        invalid('datasets', `数据集 "${dataset.id}" 至少需要一个图表或表格`)
      }
      return dataset
    })
    return {
      title: optionalText(raw.title, 'title') ?? '数据故事',
      summary: optionalText(raw.summary, 'summary'),
      datasets,
    }
  })
}

const propFields: readonly KitPropField[] = [
  { key: 'title', label: '故事标题', type: 'string', defaultValue: '数据故事' },
]
const idSchema = {
  type: 'string',
  pattern: stableIdPattern,
  maxLength: DATA_POINT_SELECTION_LIMITS.id,
}
const textSchema = { type: 'string', minLength: 1 }
const labelSchema = { ...textSchema, maxLength: DATA_POINT_SELECTION_LIMITS.label }
const viewProperties = { id: idSchema, title: textSchema, datasetId: idSchema }

export const DATA_STORY_TEMPLATE: KitTemplateDefinition<DataStoryData> = {
  type: 'data-story',
  title: '数据故事',
  description: '对同一数据集筛选图表和明细表，选择一个或多个数据点发起批注。',
  guide:
    '使用 JSON。datasets 每项含 id、title、columns（列 id、label、kind: text 或 number）、rows（稳定行 id、按列 id 提供的 values）。可用 filterBy 指定一个文本列同时筛选图表和表格。charts 每项含 id、title、datasetId、category（标签列）及 value（数值列）；tables 每项含 id、title、datasetId、columns（列 ID 列表）。每个数据集至少声明一个图表或表格。保持数据集、图表与行 ID 稳定以定位批注。',
  example: JSON.stringify(
    {
      title: '结账接口延迟',
      summary: '按区域查看 P95 延迟，对异常项发起数据点批注。',
      datasets: [
        {
          id: 'latency',
          title: '最近 24 小时',
          filterBy: 'region',
          columns: [
            { id: 'region', label: '区域', kind: 'text' },
            { id: 'route', label: '接口', kind: 'text' },
            { id: 'p95', label: 'P95（毫秒）', kind: 'number' },
          ],
          rows: [
            { id: 'hz-cart', values: { region: '杭州', route: '购物车（杭州）', p95: 125 } },
            { id: 'hz-pay', values: { region: '杭州', route: '支付（杭州）', p95: 268 } },
            { id: 'sh-cart', values: { region: '上海', route: '购物车（上海）', p95: 143 } },
          ],
        },
      ],
      charts: [
        {
          id: 'by-route',
          datasetId: 'latency',
          title: '接口延迟分布',
          category: 'route',
          value: 'p95',
        },
      ],
      tables: [
        {
          id: 'detail',
          datasetId: 'latency',
          title: '采样明细',
          columns: ['region', 'route', 'p95'],
        },
      ],
    },
    null,
    2,
  ),
  propFields,
  propsSchema: buildPropsJsonSchema(
    ['datasets'],
    {
      summary: textSchema,
      datasets: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'title', 'columns', 'rows'],
          properties: {
            id: idSchema,
            title: textSchema,
            filterBy: idSchema,
            columns: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['id', 'label', 'kind'],
                properties: {
                  id: idSchema,
                  label: labelSchema,
                  kind: { enum: ['text', 'number'] },
                },
              },
            },
            rows: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'values'],
                properties: {
                  id: idSchema,
                  values: {
                    type: 'object',
                    propertyNames: idSchema,
                    additionalProperties: { type: ['string', 'number'] },
                  },
                },
              },
            },
          },
        },
      },
      charts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'datasetId', 'category', 'value'],
          properties: {
            ...viewProperties,
            title: labelSchema,
            category: idSchema,
            value: idSchema,
          },
        },
      },
      tables: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'datasetId', 'columns'],
          properties: {
            ...viewProperties,
            columns: { type: 'array', minItems: 1, uniqueItems: true, items: idSchema },
          },
        },
      },
    },
    propFields,
  ),
  parse: parseDataStory,
  validate: (source) => decisionDiagnostics(parseDataStory(source)),
}
