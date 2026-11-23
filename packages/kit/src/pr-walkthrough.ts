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

// unified：统一 diff；split：新旧并排
export type WalkthroughDiffMode = 'unified' | 'split'

/** diff 里的一行；`old`、`new` 是它在新旧文件里的行号，缺省表示该侧没有这一行。 */
export type WalkthroughLine = {
  text: string
  noNewline?: boolean
} & (
  | { kind: 'context'; old: number; new: number }
  | { kind: 'remove'; old: number; new?: never }
  | { kind: 'add'; old?: never; new: number }
)

interface WalkthroughHunk {
  header: string
  lines: WalkthroughLine[]
}

/** 被走查的一个文件。 */
export interface WalkthroughFile {
  id: string
  path: string
  note?: string
  hunks: WalkthroughHunk[]
}

interface WalkthroughChapter {
  id: string
  title: string
  summary?: string
  files: WalkthroughFile[]
}

export interface PrWalkthroughData {
  title: string
  summary?: string
  diffMode: WalkthroughDiffMode
  chapters: WalkthroughChapter[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/
const FILE_HEADER =
  /^(diff --git|index|---|\+\+\+|new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to) /

type HunkCursor = { old: number; new: number; oldEnd: number; newEnd: number }

function parseHunks(diff: string, field: string): WalkthroughHunk[] {
  const rawLines = diff.split(/\r?\n/)
  if (rawLines.at(-1) === '') rawLines.pop()
  const hunks: WalkthroughHunk[] = []
  const metadata = new Set<string>()
  let current: WalkthroughHunk | undefined
  let cursor: HunkCursor | undefined

  for (const [index, content] of rawLines.entries()) {
    const at = `${field} 第 ${index + 1} 行`
    const header = HUNK_HEADER.exec(content)
    if (header) {
      const oldStart = Number(header[1])
      const newStart = Number(header[3])
      const oldCount = Number(header[2] ?? 1)
      const newCount = Number(header[4] ?? 1)
      if ((oldCount && oldStart < 1) || (newCount && newStart < 1) || (!oldCount && !newCount)) {
        invalid(at, '包含无效的差异区段范围')
      }
      // 空区段的行号是插入点之前的行；下一条仍然必须从未占用的位置开始。
      const old = oldStart + Number(oldCount === 0)
      const next = newStart + Number(newCount === 0)
      const oldEnd = old + oldCount
      const newEnd = next + newCount
      if (!Number.isSafeInteger(oldEnd) || !Number.isSafeInteger(newEnd)) {
        invalid(at, '行号超出有效范围')
      }
      if (cursor) {
        if (cursor.old !== cursor.oldEnd || cursor.new !== cursor.newEnd) {
          invalid(at, '前一差异区段的行数与区段标题不符')
        }
        if (old < cursor.oldEnd || next < cursor.newEnd) {
          invalid(at, '差异区段必须按行号递增，且不能重叠')
        }
      }
      current = { header: content, lines: [] }
      cursor = { old, new: next, oldEnd, newEnd }
      hunks.push(current)
      continue
    }

    if (!current || !cursor) {
      const token = FILE_HEADER.exec(content)?.[1]
      if (!token || metadata.has(token)) invalid(at, '无法识别为单文件统一 diff 的文件头或区段')
      metadata.add(token)
      continue
    }

    const line = content.slice(1)
    if (content === '\\ No newline at end of file') {
      const previous = current.lines.at(-1)
      if (!previous || previous.noNewline) invalid(at, '缺少对应的差异行')
      previous.noNewline = true
    } else if (content.startsWith(' ')) {
      current.lines.push({ kind: 'context', old: cursor.old++, new: cursor.new++, text: line })
    } else if (content.startsWith('-')) {
      current.lines.push({ kind: 'remove', old: cursor.old++, text: line })
    } else if (content.startsWith('+')) {
      current.lines.push({ kind: 'add', new: cursor.new++, text: line })
    } else {
      invalid(at, '差异行必须以空格、加号或减号开头')
    }
    if (cursor.old > cursor.oldEnd || cursor.new > cursor.newEnd) {
      invalid(at, '差异区段的行数超出区段标题声明的范围')
    }
  }

  if (!cursor) invalid(field, '至少需要一个以 @@ 开头的差异区段')
  if (cursor.old !== cursor.oldEnd || cursor.new !== cursor.newEnd) {
    invalid(field, '最后一个差异区段的行数与区段标题不符')
  }
  return hunks
}

function parsePrWalkthrough(source: string) {
  return parseDecision<PrWalkthroughData>(source, (raw) => {
    const files = list(
      raw.files,
      'files',
      (item, at): WalkthroughFile => {
        const file = object(item, at)
        return {
          id: stableId(file.id, `${at}.id`),
          path: text(file.path, `${at}.path`),
          note: optionalText(file.note, `${at}.note`),
          hunks: parseHunks(text(file.diff, `${at}.diff`), `${at}.diff`),
        }
      },
      true,
    )
    const fileIndex = uniqueIndex(files, (file) => file.id, 'files')
    const chapters = list(
      raw.chapters,
      'chapters',
      (item, at): WalkthroughChapter => {
        const chapter = object(item, at)
        const references = list(chapter.files, `${at}.files`, stableId, true)
        uniqueIndex(references, (id) => id, `${at}.files`)
        return {
          id: stableId(chapter.id, `${at}.id`),
          title: text(chapter.title, `${at}.title`),
          summary: optionalText(chapter.summary, `${at}.summary`),
          files: references.map((id) => {
            const file = fileIndex.get(id)
            if (!file) invalid(`${at}.files`, `引用了不存在的文件 "${id}"`)
            return file
          }),
        }
      },
      true,
    )
    uniqueIndex(chapters, (chapter) => chapter.id, 'chapters')
    const diffMode = raw.diffMode === undefined ? 'unified' : raw.diffMode
    if (diffMode !== 'unified' && diffMode !== 'split') {
      invalid('diffMode', '必须为 unified 或 split')
    }
    return {
      title: optionalText(raw.title, 'title') ?? 'PR 走查',
      summary: optionalText(raw.summary, 'summary'),
      diffMode,
      chapters,
    }
  })
}

const propFields: readonly KitPropField[] = [
  { key: 'title', label: '走查标题', type: 'string', defaultValue: 'PR 走查' },
  {
    key: 'diffMode',
    label: '初始差异视图',
    type: 'select',
    defaultValue: 'unified',
    options: [
      { value: 'unified', label: '统一' },
      { value: 'split', label: '并排' },
    ],
  },
]
const idSchema = { type: 'string', pattern: stableIdPattern }
const textSchema = { type: 'string', minLength: 1 }

export const PR_WALKTHROUGH_TEMPLATE: KitTemplateDefinition<PrWalkthroughData> = {
  type: 'pr-walkthrough',
  title: 'PR 走查',
  description: '逐章解释代码变更，支持统一或并排差异视图与行级批注。',
  guide:
    '使用 JSON。chapters 每项含 id、title、files（引用文件 ID）；可用 summary 导读。files 每项含 id、path、diff，可加 note。diff 使用单文件 git 统一 diff（可省略文件头），保留 @@ 区段标题和每行前导空格、+、-。保留章节和文件的稳定 id；批注以文件 ID、旧/新版及行号定位。',
  example: JSON.stringify(
    {
      title: '缩短缓存预热时间',
      summary: '先缩减默认 TTL，再检查缺失记录的回退路径。',
      chapters: [
        {
          id: 'ttl',
          title: '缓存时效',
          summary: '沿用原有配置项，减少旧结果的存留。',
          files: ['settings'],
        },
        { id: 'fallback', title: '回退行为', files: ['reader'] },
      ],
      files: [
        {
          id: 'settings',
          path: 'src/cache/settings.ts',
          note: '秒级 TTL 是本次唯一的配置变化。',
          diff: '@@ -8,2 +8,2 @@\n const namespace = "products"\n-export const ttl = 120\n+export const ttl = 30',
        },
        {
          id: 'reader',
          path: 'src/cache/reader.ts',
          diff: '@@ -15,2 +15,3 @@\n const cached = await readCache(key)\n+if (cached === undefined) return readOrigin(key)\n return cached',
        },
      ],
    },
    null,
    2,
  ),
  propFields,
  propsSchema: buildPropsJsonSchema(
    ['chapters', 'files'],
    {
      summary: textSchema,
      chapters: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'title', 'files'],
          properties: {
            id: idSchema,
            title: textSchema,
            summary: textSchema,
            files: { type: 'array', minItems: 1, uniqueItems: true, items: idSchema },
          },
        },
      },
      files: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'path', 'diff'],
          properties: { id: idSchema, path: textSchema, note: textSchema, diff: textSchema },
        },
      },
    },
    propFields,
  ),
  parse: parsePrWalkthrough,
  validate: (source) => decisionDiagnostics(parsePrWalkthrough(source)),
}
