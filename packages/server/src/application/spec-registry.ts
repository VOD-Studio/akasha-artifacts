import type { ArtifactSpecOutput, ArtifactType, CheckDiagnostic } from '@akasha/protocol'

export const SANDBOX_DEPENDENCY_WHITELIST = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'lucide-react',
  'recharts',
  'shiki',
  'mermaid',
  'marked',
  '@violetjs/inkline',
  '@akasha/kit',
  '@akasha/runtime',
] as const

export interface ArtifactSpecDefinition {
  type: ArtifactType
  guide: string
  whitelist?: readonly string[]
  schema?: Record<string, unknown>
  example?: string
  validate?: (source: string) => CheckDiagnostic[]
}

// 按需写作规范与模板校验注册表：Kit 模板扩展时只需注册自身定义，无需维护重复文档。
export class SpecRegistry {
  private readonly specs = new Map<ArtifactType, ArtifactSpecDefinition>()

  constructor() {
    for (const def of BUILTIN_SPECS) {
      this.specs.set(def.type, def)
    }
  }

  register(def: ArtifactSpecDefinition): void {
    this.specs.set(def.type, def)
  }

  getDefinition(type: ArtifactType): ArtifactSpecDefinition | undefined {
    return this.specs.get(type)
  }

  getSpec(type: ArtifactType): ArtifactSpecOutput {
    const def = this.specs.get(type)
    if (!def) {
      return {
        type,
        guide: `类型为 "${type}" 的自由渲染内容。发布前请先运行 artifact_check。`,
        whitelist: [...SANDBOX_DEPENDENCY_WHITELIST],
      }
    }
    return {
      type: def.type,
      guide: def.guide,
      whitelist: [...(def.whitelist ?? SANDBOX_DEPENDENCY_WHITELIST)],
      ...(def.schema ? { schema: def.schema } : {}),
      ...(def.example ? { example: def.example } : {}),
    }
  }

  listTypes(): readonly ArtifactType[] {
    return Array.from(this.specs.keys())
  }
}

function validateArrayItemsHaveTitle(
  source: string,
  field: string,
  typeLabel: string,
): CheckDiagnostic[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const items = (parsed as Record<string, unknown>)[field]
  if (!Array.isArray(items)) {
    return [
      {
        severity: 'error',
        code: 'INVALID_KIT_FIELD_TYPE',
        message: `${typeLabel} 的 "${field}" 必须为数组`,
      },
    ]
  }
  const diagnostics: CheckDiagnostic[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_KIT_ITEM',
        message: `${typeLabel}.${field}[${i}] 必须为对象`,
      })
      continue
    }
    const title = (item as { title?: unknown }).title
    if (typeof title !== 'string' || title.trim().length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'MISSING_ITEM_TITLE',
        message: `${typeLabel}.${field}[${i}] 缺少非空字符串字段 "title"`,
        suggestion: `请为 ${field}[${i}] 补充 title 字段`,
      })
    }
  }
  return diagnostics
}

const BUILTIN_SPECS: ArtifactSpecDefinition[] = [
  {
    type: 'react',
    guide:
      '导出默认 React 组件（export default function App()）。仅可使用白名单依赖；运行时数据用 useArtifactState() 读取，需跨重绘保留的调参控件使用 usePersistentControl(key, defaultValue) 或 data-ak-persist。',
    example:
      "import { useState } from 'react'\nexport default function App() {\n  const [count, setCount] = useState(0)\n  return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>\n}",
  },
  {
    type: 'html',
    guide:
      '自包含 HTML 片段或文档，不可加载外部网络脚本/样式；可交互调参控件添加 data-ak-persist="<key>" 以在代码更新时保留用户已调参数。',
    example:
      '<div class="p-4"><label>阈值 <input type="range" data-ak-persist="threshold" min="0" max="100" value="50" /></label></div>',
  },
  {
    type: 'markdown',
    guide: '标准 GitHub Flavored Markdown，支持表格、代码块与 Mermaid 围栏。',
    example: '# 设计说明\n\n- 要点 1\n- 要点 2',
  },
  {
    type: 'mermaid',
    guide:
      '纯 Mermaid 图表定义源码（flowchart / sequenceDiagram / stateDiagram-v2 / classDiagram / erDiagram）；沙盒内置 @violetjs/inkline 可切换手绘矢量风格。',
    example: 'flowchart LR\n  Agent --> Daemon --> Browser',
  },
  {
    type: 'svg',
    guide: '纯静态 SVG 矢量图形，必须以 <svg> 为根元素且禁止包含 <script> 或内联事件处理器。',
    example:
      '<svg viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="40" rx="8" fill="#10B981"/></svg>',
  },
  {
    type: 'artboard',
    guide:
      'JSON 格式并排多画板定义：包含 pages、boards、flows 与 groups（可选 choose/recommended/verify）。用于同时对比多个 UI 或架构方案并分轮选择。',
    schema: {
      type: 'object',
      required: ['boards'],
      properties: {
        boards: { type: 'array' },
        flows: { type: 'array' },
        groups: { type: 'array' },
      },
      'x-akasha-props': [
        {
          key: 'columns',
          label: '每行画板列数',
          type: 'number',
          defaultValue: 2,
          min: 1,
          max: 4,
          step: 1,
        },
        { key: 'showFlows', label: '显示页面流程连线', type: 'boolean', defaultValue: true },
        {
          key: 'handDrawnFlows',
          label: '手绘风格连线（Inkline）',
          type: 'boolean',
          defaultValue: true,
        },
      ],
    },
    example: JSON.stringify(
      {
        boards: [
          { id: 'opt-a', title: '方案 A', html: '<div>方案 A</div>' },
          { id: 'opt-b', title: '方案 B', html: '<div>方案 B</div>' },
        ],
        groups: [
          {
            id: 'q1',
            title: '选择布局',
            kind: 'choose',
            options: ['opt-a', 'opt-b'],
            recommended: 'opt-b',
          },
        ],
      },
      null,
      2,
    ),
    validate: (source) => validateArrayItemsHaveTitle(source, 'boards', 'artboard'),
  },
  {
    type: 'document',
    guide:
      '结构化设计文档：支持带唯一稳定块标识（id / data-ak-block）的 HTML 或 JSON（sections/paragraphs/questions），以便在增删行后仍能稳定锚定句级批注与行内提问。',
    schema: {
      type: 'object',
      properties: {
        sections: { type: 'array' },
      },
      'x-akasha-props': [
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
        { key: 'showQuestions', label: '显示行内 Agent 提问', type: 'boolean', defaultValue: true },
      ],
    },
    example:
      '<article>\n  <h1 id="title">架构方案</h1>\n  <p id="p1">核心目标与边界说明。</p>\n</article>',
  },
  {
    type: 'verify',
    guide:
      'JSON 格式交付验收报告：包含 claims（逐条可验证声明与原始命令输出证据）、unverified（未验证项及原因）与可选 screens（预期稿与实际界面对比），供人执行 Pass / Reject / Waive 裁决。',
    schema: {
      type: 'object',
      required: ['claims'],
      properties: {
        claims: { type: 'array' },
        unverified: { type: 'array' },
        screens: { type: 'array' },
      },
      'x-akasha-props': [
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
        { key: 'showUnverified', label: '展示未验证项清单', type: 'boolean', defaultValue: true },
      ],
    },
    example: JSON.stringify(
      {
        claims: [
          { id: 'c1', title: '单元测试通过', status: 'checked', evidence: '16 passed (16)' },
        ],
        unverified: [{ id: 'u1', title: '生产环境冷启动', reason: '尚未部署到线上' }],
      },
      null,
      2,
    ),
    validate: (source) => validateArrayItemsHaveTitle(source, 'claims', 'verify'),
  },
  {
    type: 'pr-walkthrough',
    guide:
      'JSON 格式 PR 走查：包含 summary、chapters 与 files（含 diff 与导读说明），支持行级批注。',
    schema: { type: 'object', required: ['chapters'], properties: { chapters: { type: 'array' } } },
  },
  {
    type: 'live-timeline',
    guide:
      'JSON 格式实时任务/排障时间线：包含 title 与 steps，运行期间优先用 artifact_push_state 增量推进步骤状态。',
    schema: {
      type: 'object',
      required: ['steps'],
      properties: { steps: { type: 'array' } },
      'x-akasha-props': [
        { key: 'title', label: '看板标题', type: 'string', defaultValue: '任务执行时间线' },
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
        { key: 'showOutputs', label: '展开原始输出日志', type: 'boolean', defaultValue: true },
      ],
    },
    validate: (source) => validateArrayItemsHaveTitle(source, 'steps', 'live-timeline'),
  },
  {
    type: 'option-compare',
    guide:
      'JSON 格式多方案对比矩阵：包含 dimensions 与 options（可选 recommended），支持一键选择并通知 Agent。',
    schema: {
      type: 'object',
      required: ['options'],
      properties: { options: { type: 'array' }, dimensions: { type: 'array' } },
      'x-akasha-props': [
        { key: 'title', label: '对比标题', type: 'string', defaultValue: '架构方案对比' },
        { key: 'highlightDiffs', label: '高亮差异维度', type: 'boolean', defaultValue: true },
        { key: 'compact', label: '紧凑视图', type: 'boolean', defaultValue: false },
      ],
    },
    validate: (source) => validateArrayItemsHaveTitle(source, 'options', 'option-compare'),
  },
  {
    type: 'data-story',
    guide: 'JSON 格式会话数据看板：包含 datasets 与 charts/tables 定义，支持筛选与下钻。',
    schema: { type: 'object', required: ['datasets'], properties: { datasets: { type: 'array' } } },
  },
]
