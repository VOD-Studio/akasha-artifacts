import {
  type ArtboardData,
  ArtboardLayoutGuidesSchema,
  ArtboardPrintLayoutSchema,
  parseArtboard,
} from '@akasha/protocol'
import { buildPropsJsonSchema, type KitPropField, type KitTemplateDefinition } from '../registry.js'
import { checkUniqueIds } from './source-validation.js'

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
    'JSON 格式定义：pages 用稳定 id 分组；页面的 includeSharedBoards 为 false 时不显示未分组画板。boards 含唯一稳定 id、title、html/description，可选 pageId、viewport（width/height 均为 1–8192 的整数）、position（画布绝对坐标 x/y，单位 CSS 像素）、layoutGroup（布局组合，不参与评审）与 recommended；flows 定义 { from, to, label }。每板可声明 designLayers，按从下到上排列，每层含画板内唯一 id、kind、相对板内的 x/y、width/height，可选 layoutGroup、color（ink/blue/rose/amber/mint 或六位 #RRGGBB）、flipX/flipY（true）。text/note 还需要 text，可选 fontSize（10–128）、fontWeight（normal/medium/semibold/bold）、textAlign（left/center/right）；rectangle/ellipse 只需几何；stroke 还需 2–2048 个按边界归一化为 0–1 的 [x, y] 采样。不要用 designLayers 取代网页的 DOM 或交互逻辑。' +
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
