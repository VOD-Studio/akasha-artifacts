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
  id: z.string().min(1),
  rootPath: z.string().min(1),
  name: z.string().min(1),
  lastActiveAt: ISODateTimeSchema,
  dormant: z.boolean().optional(),
})
export type Project = z.infer<typeof ProjectSchema>

/** 制品：可单独打开与评审的交付物，以 `publicId` 或项目内 `slug` 定位。 */
export const ArtifactSchema = z.object({
  publicId: PublicIdSchema,
  slug: SlugSchema,
  projectId: z.string().min(1),
  title: z.string().min(1),
  type: ArtifactTypeSchema,
  visibility: VisibilitySchema,
  headVersion: z.number().int().min(1),
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
})
export type Artifact = z.infer<typeof ArtifactSchema>

/** 版本：制品的一份不可变源码快照，一经写入不能修改。 */
export const VersionSchema = z.object({
  artifactId: PublicIdSchema,
  version: z.number().int().min(1),
  parentVersion: z.number().int().min(1).nullable(),
  author: AuthorSchema,
  title: z.string().min(1),
  source: z.string(),
  createdAt: ISODateTimeSchema,
})
export type Version = z.infer<typeof VersionSchema>

/**
 * RFC 6902 JSON Patch 的单条原子操作。
 *
 * @remarks 应用方在深拷贝上按序执行整批补丁，任一步失败则整批不生效并抛 `PATCH_FAILED`。
 */
export const JsonPatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: JsonPointerSchema }),
  z.object({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('move'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('copy'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('test'), path: JsonPointerSchema, value: z.unknown() }),
])
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>

/** 一次状态流推送的载荷：对当前状态快照按序应用的补丁，不产生代码版本。 */
export const StatePatchSchema = z.object({
  artifactId: PublicIdSchema,
  ops: z.array(JsonPatchOpSchema).min(1),
})
export type StatePatch = z.infer<typeof StatePatchSchema>

/** 状态流中已入库的一条补丁；回放快照以补丁序列为唯一事实源。 */
export const StatePatchEntrySchema = z.object({
  seq: z.number().int().min(1),
  ops: z.array(JsonPatchOpSchema).min(1),
  createdAt: ISODateTimeSchema,
})
export type StatePatchEntry = z.infer<typeof StatePatchEntrySchema>

/** 状态流在某个补丁序号处的完整 JSON 状态。 */
export const StateStreamSnapshotSchema = z.object({
  artifactId: PublicIdSchema,
  seq: z.number().int().min(0),
  snapshot: z.record(z.string(), z.unknown()),
  updatedAt: ISODateTimeSchema,
})
export type StateStreamSnapshot = z.infer<typeof StateStreamSnapshotSchema>

/** 元素相对沙盒 iframe 视口的矩形，单位为 CSS 像素。 */
export const ElementRectSchema = z.object({
  x: z.number(),
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
    boardId: z.string().min(1).optional(),
    blockId: z.string().min(1).optional(),
    loc: z
      .string()
      .regex(/^\d+:\d+(?:-\d+:\d+)?$/, 'loc 须为 line:col 或 line:col-line:col')
      .optional(),
    selector: z.string().min(1).optional(),
    rect: ElementRectSchema.optional(),
    textPreview: z.string().max(400).optional(),
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
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['choose', 'verify']),
  options: z.array(z.string().min(1)).optional(),
  recommended: z.string().min(1).optional(),
  choice: z.string().min(1).nullable().optional(),
  verdict: VerdictSchema.nullable().optional(),
  note: z.string().optional(),
})
export type ReviewGroup = z.infer<typeof ReviewGroupSchema>

/** `drafting` → `submitted` → `closed`；`submitted` 可撤回，开启新一轮会把旧轮次转为 `closed`。 */
export const ReviewRoundStatusSchema = z.enum(['drafting', 'submitted', 'closed'])
export type ReviewRoundStatus = z.infer<typeof ReviewRoundStatusSchema>

/** 评审轮次：一批需要人整体审阅后再唤醒 Agent 的待决项。 */
export const ReviewRoundSchema = z.object({
  id: z.string().min(1),
  artifactId: PublicIdSchema,
  status: ReviewRoundStatusSchema,
  groups: z.array(ReviewGroupSchema),
  submittedAt: ISODateTimeSchema.nullable(),
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
  id: z.string().min(1),
  artifactId: PublicIdSchema,
  version: z.number().int().min(1),
  roundId: z.string().min(1).nullable(),
  groupId: z.string().min(1).nullable(),
  kind: FeedbackKindSchema,
  element: ElementRefSchema.nullable(),
  body: z.string(),
  author: AuthorSchema,
  draft: z.boolean(),
  status: FeedbackStatusSchema,
  createdAt: ISODateTimeSchema,
  updatedAt: ISODateTimeSchema,
})
export type Feedback = z.infer<typeof FeedbackSchema>

/**
 * 读取回执：拉取完整反馈证据时签发，凭它确认消费。
 *
 * @remarks 只能消费一次；重复或伪造的回执抛 `INVALID_RECEIPT`。
 */
export const ReceiptSchema = z.object({
  receipt: z.string().min(1),
  artifactId: PublicIdSchema.nullable(),
  cursor: z.string().min(1),
  feedbackIds: z.array(z.string().min(1)),
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
  z.object({ kind: z.literal('text'), loc: LocSchema, value: z.string() }),
  z.object({ kind: z.literal('className'), loc: LocSchema, value: z.string() }),
  z.object({
    kind: z.literal('attr'),
    loc: LocSchema,
    name: z.string().min(1),
    value: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('move'),
    loc: LocSchema,
    targetParentLoc: LocSchema,
    index: z.number().int().min(0),
  }),
  z.object({ kind: z.literal('remove'), loc: LocSchema }),
])
export type EditOp = z.infer<typeof EditOpSchema>

/** 校验门禁的一条诊断。 */
export const CheckDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  suggestion: z.string().optional(),
})
export type CheckDiagnostic = z.infer<typeof CheckDiagnosticSchema>

/** 校验门禁的结果。 */
export const CheckResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(CheckDiagnosticSchema),
  warnings: z.array(CheckDiagnosticSchema),
})
export type CheckResult = z.infer<typeof CheckResultSchema>
