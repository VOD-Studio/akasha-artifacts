import { z } from 'zod'
import {
  ArtifactSchema,
  CheckResultSchema,
  ElementRefSchema,
  FeedbackSchema,
  JsonPatchOpSchema,
  ReviewRoundSchema,
  StateStreamSnapshotSchema,
  VerdictSchema,
  VersionSchema,
} from './domain.js'
import { ArtifactTypeSchema, PublicIdSchema, SlugSchema, VisibilitySchema } from './primitives.js'

/**
 * 以不可变 `publicId` 或项目内可读 `slug` 定位制品。
 *
 * @remarks 按 `slug` 查找时先看 `project` 指定的项目（缺省为默认项目），
 * 未命中则在全部项目里找唯一同名的制品。
 */
export const ArtifactIdentifierSchema = z.union([PublicIdSchema, SlugSchema])
export type ArtifactIdentifier = z.infer<typeof ArtifactIdentifierSchema>

export const ArtifactPublishInputSchema = z.object({
  // 所属项目的 `Project.id`；省略时取默认项目
  project: z.string().min(1).optional(),
  slug: SlugSchema,
  // 仅含空白时，新建取 `slug`、更新沿用旧标题
  title: z.string().min(1),
  type: ArtifactTypeSchema,
  source: z.string(),
  // 更新已有制品时必填；省略返回 400，落后于头版本返回 409
  baseVersion: z.number().int().min(1).optional(),
  // 省略时新建为 `private`、更新沿用原值
  visibility: VisibilitySchema.optional(),
})
export type ArtifactPublishInput = z.infer<typeof ArtifactPublishInputSchema>

export const ArtifactPublishOutputSchema = z.object({
  publicId: PublicIdSchema,
  slug: SlugSchema,
  // 本次写入生成的版本号
  version: z.number().int().min(1),
  // 制品页面的链接
  url: z.url(),
  // 仅未带 `baseVersion` 的新建返回：该类型的写作规范
  specHint: z.string().optional(),
})
export type ArtifactPublishOutput = z.infer<typeof ArtifactPublishOutputSchema>

/** 增量替换的一条编辑：`old_str` 须在当前源码中恰好匹配一次。 */
export const TextEditSchema = z.object({
  // 被替换的原文；为空、零匹配、多处匹配都返回错误
  old_str: z.string().min(1),
  // 替换后的文本；空串表示删除
  new_str: z.string(),
})
export type TextEdit = z.infer<typeof TextEditSchema>

export const ArtifactUpdateInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  // 必填；须等于当前头版本，否则返回 409
  baseVersion: z.number().int().min(1),
  // 仅含空白时沿用旧标题
  title: z.string().min(1).optional(),
  // 按序应用，后一条在前一条的结果上匹配；任一条失败则整体不生效
  edits: z.array(TextEditSchema).min(1),
})
export type ArtifactUpdateInput = z.infer<typeof ArtifactUpdateInputSchema>

export const ArtifactUpdateOutputSchema = z.object({
  publicId: PublicIdSchema,
  version: z.number().int().min(1),
  url: z.url(),
})
export type ArtifactUpdateOutput = z.infer<typeof ArtifactUpdateOutputSchema>

export const ArtifactCheckInputSchema = z.object({
  type: ArtifactTypeSchema,
  source: z.string(),
  project: z.string().min(1).optional(),
})
export type ArtifactCheckInput = z.infer<typeof ArtifactCheckInputSchema>

export const ArtifactCheckOutputSchema = CheckResultSchema
export type ArtifactCheckOutput = z.infer<typeof ArtifactCheckOutputSchema>

export const ArtifactSpecInputSchema = z.object({
  type: ArtifactTypeSchema,
})
export type ArtifactSpecInput = z.infer<typeof ArtifactSpecInputSchema>

export const ArtifactSpecOutputSchema = z.object({
  type: ArtifactTypeSchema,
  // 写作规范全文
  guide: z.string(),
  // 允许 import 的依赖；类型未注册专属白名单时回退为沙盒全局白名单
  whitelist: z.array(z.string()),
  // 模板的 props schema；自由渲染的类型没有
  schema: z.record(z.string(), z.unknown()).optional(),
  // 最小示例源码
  example: z.string().optional(),
})
export type ArtifactSpecOutput = z.infer<typeof ArtifactSpecOutputSchema>

export const ArtifactPushStateInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  // 按序应用到最新状态；任一条失败则整批不生效
  patch: z.array(JsonPatchOpSchema).min(1),
})
export type ArtifactPushStateInput = z.infer<typeof ArtifactPushStateInputSchema>

export const ArtifactPushStateOutputSchema = z.object({
  publicId: PublicIdSchema,
  // 本次推送后的状态流序号
  seq: z.number().int().min(1),
})
export type ArtifactPushStateOutput = z.infer<typeof ArtifactPushStateOutputSchema>

export const ArtifactGetInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  // 省略时取头版本
  version: z.number().int().min(1).optional(),
})
export type ArtifactGetInput = z.infer<typeof ArtifactGetInputSchema>

export const ArtifactGetOutputSchema = z.object({
  artifact: ArtifactSchema,
  version: VersionSchema,
  // 最新的状态快照，与 `version` 无关
  state: StateStreamSnapshotSchema,
  rounds: z.array(ReviewRoundSchema),
})
export type ArtifactGetOutput = z.infer<typeof ArtifactGetOutputSchema>

/** 无授权语义的固定快照引用；CLI 始终按自己绑定的项目与读取权限重新取回。 */
export const ArtifactHandoffReferenceSchema = z
  .object({
    artifactId: PublicIdSchema,
    // 接收方 MCP 配置绑定的 Project.id，而不是磁盘路径
    projectId: z.string().min(1).max(512),
    version: z.number().int().positive(),
    // 空字符串指向画布的总览或未分组页面
    pageId: z.string().max(512).optional(),
    boardId: z.string().min(1).max(512).optional(),
    // 选择器和文本只是定位证据，不作为代码执行
    element: ElementRefSchema.optional(),
  })
  .refine(
    ({ boardId, element }) =>
      !element || Boolean(boardId && (!element.boardId || element.boardId === boardId)),
    {
      path: ['element'],
      message: '选区必须属于交接中指定的画板',
    },
  )
export type ArtifactHandoffReference = z.infer<typeof ArtifactHandoffReferenceSchema>

/** 取回交接而不回退到头版本。 */
export const ArtifactReadHandoffInputSchema = z.object({ handoff: ArtifactHandoffReferenceSchema })

export const ArtifactPullFeedbackInputSchema = z.object({
  // 省略时拉取 `project` 内的全部制品；两者都省略则不限范围
  id: ArtifactIdentifierSchema.optional(),
  project: z.string().min(1).optional(),
  // 上次返回的 `cursor`；只返回其后的反馈
  after: z.string().optional(),
  // 只预览旧接口产生的草稿；显式投递的批注须先提交本轮
  includeDrafts: z.boolean().optional().default(false),
  // 缺省 true；false 时不签发回执
  detail: z.boolean().optional().default(true),
})
export type ArtifactPullFeedbackInput = z.infer<typeof ArtifactPullFeedbackInputSchema>

export const ArtifactPullFeedbackOutputSchema = z.object({
  items: z.array(FeedbackSchema),
  // 结果涉及的制品的评审轮次
  rounds: z.array(ReviewRoundSchema),
  // 传给下次的 `after`；没有新反馈时原样返回入参
  cursor: z.string(),
  // 仅 detail=true 时返回回执，预览拉取不推进消费游标
  receipt: z.string().min(1).optional(),
})
export type ArtifactPullFeedbackOutput = z.infer<typeof ArtifactPullFeedbackOutputSchema>

export const ArtifactAckFeedbackInputSchema = z.object({
  receipt: z.string().min(1),
  // 一并标记为 `resolved` 的反馈 id
  resolveIds: z.array(z.string().min(1)).optional(),
})
export type ArtifactAckFeedbackInput = z.infer<typeof ArtifactAckFeedbackInputSchema>

export const ArtifactAckFeedbackOutputSchema = z.object({
  // 回执覆盖并确认消费的条数
  acknowledged: z.number().int().min(0),
  // 其中被标记为 `resolved` 的条数
  resolved: z.number().int().min(0),
})
export type ArtifactAckFeedbackOutput = z.infer<typeof ArtifactAckFeedbackOutputSchema>

export const ArtifactAwaitFeedbackInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  // 上次返回的 `cursor`；超时后继续携带等待
  after: z.string().optional(),
  // 上限 50 秒，低于常见 MCP 客户端工具调用超时
  timeoutSec: z.number().int().min(1).max(50).optional().default(45),
})
export type ArtifactAwaitFeedbackInput = z.infer<typeof ArtifactAwaitFeedbackInputSchema>

export const ArtifactAwaitFeedbackOutputSchema = z.object({
  // `received`：有新反馈或本轮刚提交；`pending`：超时且无新内容
  status: z.enum(['received', 'pending']),
  items: z.array(FeedbackSchema),
  rounds: z.array(ReviewRoundSchema),
  cursor: z.string(),
  // 等到反馈时才有
  receipt: z.string().min(1).optional(),
})
export type ArtifactAwaitFeedbackOutput = z.infer<typeof ArtifactAwaitFeedbackOutputSchema>

export const ArtifactRecordVerdictInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  // 省略时取最新一轮
  roundId: z.string().min(1).optional(),
  // 省略时只做 `submitRound`，不改任何分组
  groupId: z.string().min(1).optional(),
  // 写入 null 表示清空选择
  choice: z.string().min(1).nullable().optional(),
  // 覆盖分组的验收裁决
  verdict: VerdictSchema.optional(),
  // 为 true 时随即提交本轮，并把本轮草稿转为可投递
  submitRound: z.boolean().optional(),
  // 覆盖分组备注
  note: z.string().optional(),
})
export type ArtifactRecordVerdictInput = z.infer<typeof ArtifactRecordVerdictInputSchema>

export const ArtifactRecordVerdictOutputSchema = z.object({
  round: ReviewRoundSchema,
})
export type ArtifactRecordVerdictOutput = z.infer<typeof ArtifactRecordVerdictOutputSchema>
