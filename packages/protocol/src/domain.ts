import { z } from 'zod'
import {
  ArtifactTypeSchema,
  AuthorSchema,
  ISODateTimeSchema,
  JsonPointerSchema,
  PublicIdSchema,
  SlugSchema,
  VisibilitySchema,
} from './primitives.js'

/**
 * 项目：Artifact 的归属范围，对应一个本地仓库根目录或一个 Hub 工作区。
 *
 * @remarks 按 `rootPath` 唯一登记；重复登记沿用既有 `id` 并刷新 `lastActiveAt`。
 */
export const ProjectSchema = z.object({
  // 本地由 `IdGenerator.id('proj')` 生成；Hub 为 `github-<userId>:<id>`，前缀标示归属用户
  id: z.string().min(1),
  // 本地为仓库根路径；Hub 落库时带 `github-<userId>:` 前缀，对外响应里裁掉
  rootPath: z.string().min(1),
  // 展示名；登记时传空则回退为 `rootPath`
  name: z.string().min(1),
  // 最近一次登记的时间
  lastActiveAt: ISODateTimeSchema,
  // 距 `lastActiveAt` 超过 7 天时为 true；由列表接口计算，不落库
  dormant: z.boolean().optional(),
})
export type Project = z.infer<typeof ProjectSchema>

/** 制品：可单独打开与评审的交付物，以 `publicId` 或项目内 `slug` 定位。 */
export const ArtifactSchema = z.object({
  // 不可变；重命名或移动后书签不失效
  publicId: PublicIdSchema,
  // 项目内唯一；`.artifacts/` 目录改名时随之更新
  slug: SlugSchema,
  // 所属 `Project.id`
  projectId: z.string().min(1),
  // 制品展示标题，可独立重命名；发布标题只有空白时新建用 slug，已有制品沿用旧标题
  title: z.string().min(1),
  // 渲染器与写作规范的查找键
  type: ArtifactTypeSchema,
  // 仅 Hub 鉴权使用；本地 Daemon 不区分
  visibility: VisibilitySchema,
  // 最新版本号，只能前进
  headVersion: z.number().int().min(1),
  // 首次发布时间
  createdAt: ISODateTimeSchema,
  // 最近一次写入，包含版本推进与只修改制品元数据
  updatedAt: ISODateTimeSchema,
})
export type Artifact = z.infer<typeof ArtifactSchema>

/** 维护者可见的撤下记录，不包含源码也不复用活动制品列表。 */
export const WithdrawnArtifactSchema = z.object({
  // 原制品的元数据与 publicId，版本和讨论仍保存在原处
  artifact: ArtifactSchema,
  // 该制品最近一次撤下的时间
  withdrawnAt: ISODateTimeSchema,
})
export type WithdrawnArtifact = z.infer<typeof WithdrawnArtifactSchema>

/** 版本：制品的一份不可变源码快照，一经写入不能修改。 */
export const VersionSchema = z.object({
  // 所属 `Artifact.publicId`
  artifactId: PublicIdSchema,
  // 同一制品内从 1 起单调递增
  version: z.number().int().min(1),
  // 父版本号；首个版本为 null
  parentVersion: z.number().int().min(1).nullable(),
  // 产生该版本的一方
  author: AuthorSchema,
  // 写入该快照时的标题；后来改名不回写历史
  title: z.string().min(1),
  // 完整源码，不是相对父版本的增量
  source: z.string(),
  // 创建时间
  createdAt: ISODateTimeSchema,
})
export type Version = z.infer<typeof VersionSchema>

/** 版本历史与画布布局只传元数据；完整源码通过指定版本另取。 */
export type VersionSummary = Omit<Version, 'source'>

/**
 * RFC 6902 JSON Patch 的单条原子操作。
 *
 * @remarks 应用方在深拷贝上按序执行整批补丁，任一步失败则整批不生效并抛 `PATCH_FAILED`。
 */
export const JsonPatchOpSchema = z.discriminatedUnion('op', [
  // 对象键新增或覆盖；数组按下标插入，path 末段为 `-` 时追加到末尾
  z.object({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  // 目标必须已存在
  z.object({ op: z.literal('remove'), path: JsonPointerSchema }),
  // 目标必须已存在
  z.object({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  // 不能把节点移入自身的子路径
  z.object({ op: z.literal('move'), from: JsonPointerSchema, path: JsonPointerSchema }),
  // 源路径必须已存在
  z.object({ op: z.literal('copy'), from: JsonPointerSchema, path: JsonPointerSchema }),
  // 目标值与 `value` 深比较，不相等即失败
  z.object({ op: z.literal('test'), path: JsonPointerSchema, value: z.unknown() }),
])
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>

/** 一次状态流推送的载荷：对当前状态快照按序应用的补丁，不产生代码版本。 */
export const StatePatchSchema = z.object({
  // 所属 `Artifact.publicId`
  artifactId: PublicIdSchema,
  // 至少一条；按序应用，任一失败则整批不生效
  ops: z.array(JsonPatchOpSchema).min(1),
})
export type StatePatch = z.infer<typeof StatePatchSchema>

/** 状态流中已入库的一条补丁；回放快照以补丁序列为唯一事实源。 */
export const StatePatchEntrySchema = z.object({
  // 同一制品内从 1 起单调递增
  seq: z.number().int().min(1),
  // 本条补丁的操作序列
  ops: z.array(JsonPatchOpSchema).min(1),
  // 入库时间
  createdAt: ISODateTimeSchema,
})
export type StatePatchEntry = z.infer<typeof StatePatchEntrySchema>

/** 状态流在某个补丁序号处的完整 JSON 状态。 */
export const StateStreamSnapshotSchema = z.object({
  // 所属 `Artifact.publicId`
  artifactId: PublicIdSchema,
  // 快照已包含的补丁序号；0 表示尚无补丁的空状态
  seq: z.number().int().min(0),
  // 根恒为对象；写入补丁不能把根替换成非对象
  snapshot: z.record(z.string(), z.unknown()),
  // 最近一次状态变更的时间
  updatedAt: ISODateTimeSchema,
})
export type StateStreamSnapshot = z.infer<typeof StateStreamSnapshotSchema>

/** 元素相对沙盒 iframe 视口的矩形，单位为 CSS 像素。 */
export const ElementRectSchema = z.object({
  // 视口左上角为原点，向右为正
  x: z.number(),
  // 向下为正
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type ElementRect = z.infer<typeof ElementRectSchema>

/** 批注所选数据点的条数上限，以及其中标识、标签的字符数上限。 */
export const DATA_POINT_SELECTION_LIMITS = { points: 64, id: 96, label: 240 } as const

/**
 * 元素引用：指向页面中一个元素的定位信息。
 *
 * @remarks 定位优先级 `blockId` > `loc` > `selector` > `textPreview`；四者至少一项非空。
 */
export const ElementRefSchema = z
  .object({
    // 画板 id；片段内的源码行列只供检查器使用，不是制品源码的编辑坐标
    boardId: z.string().min(1).optional(),
    // 稳定块标识：来自 `data-ak-block` 或 `id`，源码增删行时不漂移
    blockId: z.string().min(1).optional(),
    // 源码位置 `line:col` 或 `line:col-line:col`，行列均从 1 起
    loc: z
      .string()
      .regex(/^\d+:\d+(?:-\d+:\d+)?$/, 'loc 须为 line:col 或 line:col-line:col')
      .optional(),
    // CSS 选择器，相对沙盒文档根
    selector: z.string().min(1).optional(),
    // 命中时的元素矩形；只用于展示，不参与定位
    rect: ElementRectSchema.optional(),
    // 元素文本片段，最多 400 字符
    textPreview: z.string().max(400).optional(),
    // data-story 框选的数据点；`points` 至少一条且 `id` 互不重复
    dataPoints: z
      .object({
        datasetId: z.string().min(1).max(DATA_POINT_SELECTION_LIMITS.id),
        chartId: z.string().min(1).max(DATA_POINT_SELECTION_LIMITS.id),
        chartTitle: z.string().min(1).max(DATA_POINT_SELECTION_LIMITS.label),
        valueLabel: z.string().min(1).max(DATA_POINT_SELECTION_LIMITS.label),
        points: z
          .array(
            z.object({
              id: z.string().min(1).max(DATA_POINT_SELECTION_LIMITS.id),
              label: z.string().max(DATA_POINT_SELECTION_LIMITS.label),
              value: z.number(),
            }),
          )
          .min(1)
          .max(DATA_POINT_SELECTION_LIMITS.points)
          .refine((points) => new Set(points.map((point) => point.id)).size === points.length, {
            message: '所选数据点的标识必须唯一',
          }),
      })
      .optional(),
  })
  .refine(
    (ref) => Boolean(ref.blockId || ref.loc || ref.selector || ref.textPreview),
    'ElementRef 至少须包含 blockId、loc、selector 或 textPreview 之一',
  )
export type ElementRef = z.infer<typeof ElementRefSchema>

/** 验收裁决：`pass` 通过、`reject` 驳回、`waive` 豁免。 */
export const VerdictSchema = z.enum(['pass', 'reject', 'waive'])
export type Verdict = z.infer<typeof VerdictSchema>

/** 评审轮次中的一个待决项：单选组或验收组。 */
export const ReviewGroupSchema = z.object({
  // 反馈经 `groupId` 关联到本组
  id: z.string().min(1),
  title: z.string().min(1),
  // `choose` 使用 `options` 与 `choice`；`verify` 使用 `verdict`
  kind: z.enum(['choose', 'verify']),
  // 仅 `choose`：候选项；给出时 `choice` 必须取自其中
  options: z.array(z.string().min(1)).optional(),
  // Agent 推荐的选项，仅作提示，不参与校验
  recommended: z.string().min(1).optional(),
  // 仅 `choose`：已选的选项；写入 null 表示清空
  choice: z.string().min(1).nullable().optional(),
  // 仅 `verify`：裁决结果
  verdict: VerdictSchema.nullable().optional(),
  // 自由备注
  note: z.string().optional(),
})
export type ReviewGroup = z.infer<typeof ReviewGroupSchema>

/** `drafting` → `submitted` → `closed`；`submitted` 可撤回，开启新一轮会把旧轮次转为 `closed`。 */
export const ReviewRoundStatusSchema = z.enum(['drafting', 'submitted', 'closed'])
export type ReviewRoundStatus = z.infer<typeof ReviewRoundStatusSchema>

/** 评审轮次：一批需要人整体审阅后再唤醒 Agent 的待决项。 */
export const ReviewRoundSchema = z.object({
  // 由 `IdGenerator.id('round')` 生成
  id: z.string().min(1),
  // 所属 `Artifact.publicId`
  artifactId: PublicIdSchema,
  // 决定关联反馈是否为草稿、分组决定能否修改
  status: ReviewRoundStatusSchema,
  // 本轮的待决项
  groups: z.array(ReviewGroupSchema),
  // 提交时间；`drafting` 状态下为 null
  submittedAt: ISODateTimeSchema.nullable(),
  // 开启时间
  createdAt: ISODateTimeSchema,
})
export type ReviewRound = z.infer<typeof ReviewRoundSchema>

/** 反馈类型；各取值含义见行尾说明。 */
export const FeedbackKindSchema = z.enum([
  'comment', // 文字批注
  'approve', // 认可
  'request_changes', // 要求修改
  'vote', // 表决
  'pass', // 验收通过
  'reject', // 验收驳回
  'waive', // 验收豁免
  'edit', // 人在网页上直接改动源码后由服务端自动写入
  'runtime_error', // 编译或运行时错误
])
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>

/** `pending` 待消费 → `delivered` 已确认消费 → `resolved` 已处理完结。 */
export const FeedbackStatusSchema = z.enum(['pending', 'delivered', 'resolved'])
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>

/** 反馈：人对某个版本的一条结构化反应；可视化直改产生的 `edit` 由服务端自动写入。 */
export const FeedbackSchema = z.object({
  // 默认 `fb_` 前缀；可视化直改写入的为 `visualedit_` 前缀，撤销链据此识别
  id: z.string().min(1),
  // 所属 `Artifact.publicId`
  artifactId: PublicIdSchema,
  // 针对的版本号；提交时该版本必须存在
  version: z.number().int().min(1),
  // 所属轮次；null 表示不属于任何轮次，此时必为非草稿
  roundId: z.string().min(1).nullable(),
  // 所属分组；不属于分组时为 null
  groupId: z.string().min(1).nullable(),
  // 评审动作或普通文字批注；只有 comment 可指定 audience
  kind: FeedbackKindSchema,
  // 所指元素；不针对具体元素时为 null
  element: ElementRefSchema.nullable(),
  // 文字内容；`edit` 为自动生成的描述
  body: z.string(),
  // 发起人；服务端自动写入的 `edit` 沿用操作者
  author: AuthorSchema,
  // human 只供讨论，agent 表示显式投递；缺省沿用旧反馈与草稿预览契约
  audience: z.enum(['human', 'agent']).optional(),
  // true 时不触发即时唤醒；所属轮次提交后转为 false
  draft: z.boolean(),
  // Agent 回执状态；只供讨论的批注不参与此状态机
  status: FeedbackStatusSchema,
  // 创建时间
  createdAt: ISODateTimeSchema,
  // 最近一次状态变更的时间
  updatedAt: ISODateTimeSchema,
})
export type Feedback = z.infer<typeof FeedbackSchema>

/** 讨论回复属于根批注，永远不会进入 Agent 投递队列。 */
export const AnnotationReplySchema = z.object({
  // 由服务端生成，同一线程内唯一
  id: z.string().min(1),
  // 由请求的浏览器身份确定
  author: AuthorSchema,
  // 纯文本回复
  body: z.string().min(1),
  // 创建回复的服务端时间
  createdAt: ISODateTimeSchema,
})
export type AnnotationReply = z.infer<typeof AnnotationReplySchema>

/** 人工解决线程的记录，与 Agent 消费回执相互独立。 */
export const AnnotationResolutionSchema = z.object({
  // 将线程设为已解决的操作者
  author: AuthorSchema,
  // 当前解决记录的服务端时间
  resolvedAt: ISODateTimeSchema,
})
export type AnnotationResolution = z.infer<typeof AnnotationResolutionSchema>

/** 已绑定 Agent 在一轮执行中真实发布的制品版本回执，不接受模型正文里的自述链接。 */
export const AgentPublicationSchema = z.object({
  // 实际写入成功的制品标识
  artifactId: PublicIdSchema,
  // 本轮提交成功的固定版本号
  version: z.number().int().positive(),
  // 仅参数应用回执携带；记录该固定版本中默认值实际改变的画板
  changed: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .min(1)
    .optional(),
})
export type AgentPublication = z.infer<typeof AgentPublicationSchema>

/** 批注线程经由本机已绑定 Agent 执行时的真实状态；与 MCP 收件回执相互独立。 */
export const AnnotationAgentStateSchema = z.enum([
  'queued', // 已绑定 Agent 正忙，本条已入队等待前序轮次完成
  'running', // 已绑定 Agent 正在执行本条批注
  'replied', // 已收到真实 Agent 回复，但本轮未发布新版本
  'published', // 已收到真实 Agent 回复，并发布了至少一个新版本
  'failed', // 投递或执行失败（如离线、中断、超时或无正文回复）
])
export type AnnotationAgentState = z.infer<typeof AnnotationAgentStateSchema>

/** 批注线程关联的已绑定 Agent 执行回执、真实正文回复与发布版本。 */
export const AnnotationAgentDeliverySchema = z.object({
  // 关联的本机 Agent 会话标识；离线或未启动轮次时可省略
  sessionId: z.uuid().optional(),
  // 关联的 Agent 会话轮次标识；排队或启动前可省略
  turnId: z.uuid().optional(),
  // 真实执行状态；用于区分排队、处理中、失败、仅回复与已发布版本
  state: AnnotationAgentStateSchema,
  // Agent CLI 返回的最后一条真实助手正文，不得用发布回执替代
  reply: z.string().optional(),
  // 失败原因（仅用户可处理提示，不含敏感环境细节）
  error: z.string().optional(),
  // 本轮经受限发布通道实际落库的版本列表
  publications: z.array(AgentPublicationSchema),
  // 最近一次状态更新的服务端时间
  updatedAt: ISODateTimeSchema,
})
export type AnnotationAgentDelivery = z.infer<typeof AnnotationAgentDeliverySchema>

/** 根批注之外的浏览器讨论记录；按 `Feedback.id` 关联。 */
export const AnnotationThreadSchema = z.object({
  // 回复按创建时间升序展示
  replies: z.array(AnnotationReplySchema),
  // null 表示未解决或重新打开
  resolution: AnnotationResolutionSchema.nullable(),
  // 显式投递给已绑定 Agent 后的执行状态、回复与版本；普通讨论或未绑定时为空
  agent: AnnotationAgentDeliverySchema.optional(),
})
export type AnnotationThread = z.infer<typeof AnnotationThreadSchema>

/** 划分可继续讨论的批注与独立的评审裁决、运行事件。 */
export function isAnnotationKind(kind: FeedbackKind): boolean {
  return kind === 'comment' || kind === 'request_changes'
}

/**
 * 读取回执：拉取完整反馈证据时签发，凭它确认消费。
 *
 * @remarks 只能消费一次；重复或伪造的回执抛 `INVALID_RECEIPT`。
 */
export const ReceiptSchema = z.object({
  // 回执令牌，由 `IdGenerator.id('rcpt')` 生成
  receipt: z.string().min(1),
  // 本次拉取限定的制品；跨制品拉取时为 null
  artifactId: PublicIdSchema.nullable(),
  // 本次返回的最大可投递顺序号；下次拉取作为 `after` 传入
  cursor: z.string().min(1),
  // 本回执覆盖的反馈 id
  feedbackIds: z.array(z.string().min(1)),
  // 签发时间
  issuedAt: ISODateTimeSchema,
})
export type Receipt = z.infer<typeof ReceiptSchema>

// EditOp 定位节点用的源码位置，格式同 `ElementRef.loc`
const LocSchema = z
  .string()
  .regex(/^\d+:\d+(?:-\d+:\d+)?$/, 'loc 须为 line:col 或 line:col-line:col')

/**
 * L4 可视化直改的原子操作：只能作用于带静态 `loc` 的源码节点。
 *
 * @remarks 由表达式、循环或运行时状态生成的内容不可直改。
 */
export const EditOpSchema = z.discriminatedUnion('kind', [
  // 替换元素的文本子节点
  z.object({ kind: z.literal('text'), loc: LocSchema, value: z.string() }),
  // 整体替换 class 字面量
  z.object({ kind: z.literal('className'), loc: LocSchema, value: z.string() }),
  // 设置属性；`value` 为 null 表示删除该属性
  z.object({
    kind: z.literal('attr'),
    loc: LocSchema,
    name: z.string().min(1),
    value: z.string().nullable(),
  }),
  // 移到 `targetParentLoc` 下的第 `index` 个子节点位置
  z.object({
    kind: z.literal('move'),
    loc: LocSchema,
    targetParentLoc: LocSchema,
    index: z.number().int().min(0),
  }),
  // 删除元素；位于条件表达式等需要占位的位置时写为 null
  z.object({ kind: z.literal('remove'), loc: LocSchema }),
])
export type EditOp = z.infer<typeof EditOpSchema>

/** 校验门禁的一条诊断。 */
export const CheckDiagnosticSchema = z.object({
  // `error` 使 `CheckResult.ok` 为 false；`warning` 只提示
  severity: z.enum(['error', 'warning']),
  // 稳定的机器可读标识，如 `DISALLOWED_IMPORT`、`DUPLICATE_BLOCK_ID`
  code: z.string().min(1),
  message: z.string().min(1),
  // 源码位置，从 1 起；无法定位时省略
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  // 给 Agent 的修复提示
  suggestion: z.string().optional(),
})
export type CheckDiagnostic = z.infer<typeof CheckDiagnosticSchema>

/** 校验门禁的结果。 */
export const CheckResultSchema = z.object({
  // 没有任何 `error` 级诊断时为 true
  ok: z.boolean(),
  errors: z.array(CheckDiagnosticSchema),
  warnings: z.array(CheckDiagnosticSchema),
})
export type CheckResult = z.infer<typeof CheckResultSchema>
