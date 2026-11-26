import { z } from 'zod'

/** 每份材料独立上传；总数和总字节数在轮次受理前再次检查。 */
export const AGENT_REFERENCE_BYTES = 2 * 1024 * 1024
/** 单轮最多交付的文件数量，包括图片和文字材料。 */
export const AGENT_REFERENCE_COUNT = 6
/** 限制同一轮所有输入的原始字节数。 */
export const AGENT_REFERENCE_TOTAL_BYTES = 8 * 1024 * 1024

/** 只接收显式选择的文件字节，不接受本机路径、URL 或可供服务端解引用的地址。 */
export const AgentReferenceInputSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(180)
    .regex(/^[^/\\\p{Cc}\p{Cf}]+$/u),
  content: z
    .string()
    .min(4)
    .max(4 * Math.ceil(AGENT_REFERENCE_BYTES / 3)),
})
export type AgentReferenceInput = z.infer<typeof AgentReferenceInputSchema>

/** 快照摘要可以随轮次保存，不能拿摘要取回已发送的附件。 */
export const AgentReferenceSummarySchema = z.strictObject({
  name: AgentReferenceInputSchema.shape.name,
  kind: z.enum(['image', 'document', 'slides', 'design']),
  bytes: z.number().int().positive().max(AGENT_REFERENCE_BYTES),
  sha256: z.string().regex(/^[a-f\d]{64}$/),
})
export type AgentReferenceSummary = z.infer<typeof AgentReferenceSummarySchema>

/** 未发布前以草稿隔离；已有作品还须绑定当前发布会话。 */
export const AgentReferenceScopeSchema = z.strictObject({
  projectId: z.string().min(1).max(1024),
  draftId: z.uuid(),
  sessionId: z.uuid().optional(),
})
export type AgentReferenceScope = z.infer<typeof AgentReferenceScopeSchema>

/** 本机预览路由只有这一种输入，不接受让服务端读取文件系统的请求。 */
export const StageAgentReferenceSchema = z.strictObject({
  scope: AgentReferenceScopeSchema,
  file: AgentReferenceInputSchema,
})

/** 撤回尚未受理的单个条目；草稿、项目及原会话都须匹配。 */
export const RemoveAgentReferenceSchema = z.strictObject({
  scope: AgentReferenceScopeSchema,
  id: z.uuid(),
})

/** 轮次只取已预览且未过期的条目，顺序与界面的实际发送清单一致。 */
export const AgentReferenceSelectionSchema = z.strictObject({
  draftId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(AGENT_REFERENCE_COUNT),
})
export type AgentReferenceSelection = z.infer<typeof AgentReferenceSelectionSchema>

/** 预览显示的是提取后实际送出的文字，或已验证的同一张本地图片。 */
export const AgentReferencePreviewSchema = AgentReferenceSummarySchema.extend({
  id: z.uuid(),
  /** 到期的 Unix 毫秒；服务端仍以受理时刻为准。 */
  expiresAt: z.number().int().positive(),
  text: z.string().optional(),
  image: z.string().optional(),
})
export type AgentReferencePreview = z.infer<typeof AgentReferencePreviewSchema>
