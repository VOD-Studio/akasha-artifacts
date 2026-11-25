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
