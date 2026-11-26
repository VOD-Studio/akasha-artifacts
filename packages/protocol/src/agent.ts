import { z } from 'zod'
import { ArtboardTweakApplicationSchema } from './artboard/tweak-application.js'
import { AgentPublicationSchema } from './domain.js'
import { PublicIdSchema } from './primitives.js'
import { ArtifactHandoffReferenceSchema } from './transport/mcp.js'

export const AgentMessageInputSchema = z
  .object({
    /** 用户输入的原始文本；不从制品源文件拼接用户消息。 */
    message: z.string().trim().min(1).max(8000),
    /** 可选的、发送时已保存的固定快照与选区。 */
    target: ArtifactHandoffReferenceSchema.optional(),
    /** 仅允许该轮提交指定快照上的这组参数。 */
    tweakApplication: ArtboardTweakApplicationSchema.optional(),
  })
  .strict()

export const AgentDesignInputSchema = AgentMessageInputSchema.pick({ message: true }).extend({
  /** 本机显式授权 Codex 接收设计任务的项目。 */
  projectId: z.string().min(1).max(1024),
})

/** 工具没有可由模型填写的目标、版本或参数，全部由该轮网页授权决定。 */
export const ApplyRequestedTweaksInputSchema = z.strictObject({})

export const AgentAvailabilitySchema = z.enum(['unbound', 'offline', 'busy', 'ready'])
export type AgentAvailability = z.infer<typeof AgentAvailabilitySchema>

export const AgentConversationTurnSchema = z.object({
  /** 服务端分配给一次已接受发送的标识。 */
  id: z.uuid(),
  /** 由批注线程触发时记录原根批注 ID，便于在对话与批注间双向审计。 */
  feedbackId: z.string().min(1).optional(),
  /** 交付给 CLI 的用户原文。 */
  message: z.string(),
  /** 用户发送时的固定选区；后续版本不会改写它。 */
  target: ArtifactHandoffReferenceSchema.optional(),
  /** running 表示已受理正交付给 CLI，并非离线排队。 */
  status: z.enum(['running', 'complete', 'failed']),
  /** CLI 返回的最后一条真实助手消息，不得用发布回执替代。 */
  reply: z.string().optional(),
  /** 失败分类对应的用户可处理提示，不暴露原始进程环境。 */
  error: z.string().optional(),
  /** 从相同轮次的受限发布通道记录，可在回复前先出现。 */
  publications: z.array(AgentPublicationSchema),
})
export type AgentConversationTurn = z.infer<typeof AgentConversationTurnSchema>

export const AgentConversationSchema = z.object({
  /** Akasha 会话标识；真实 CLI thread ID 仅留在服务端。 */
  id: z.uuid(),
  /** 从首次派发起不变的授权项目。 */
  projectId: z.string(),
  /** 实际发布第一版后绑定的制品；未发布时为空。 */
  artifactId: PublicIdSchema.optional(),
  /** 负责此会话的、本机显式授权的 Harness。 */
  harness: z.literal('codex'),
  /** 按发送顺序保存的最近轮次。 */
  turns: z.array(AgentConversationTurnSchema),
})
export type AgentConversation = z.infer<typeof AgentConversationSchema>

export const AgentConversationStatusSchema = z.object({
  /** 当前制品能否派发的原因，与上一轮是否成功独立。 */
  availability: AgentAvailabilitySchema,
  /** 未由受管 CLI 会话发布的制品没有伪造的对话记录。 */
  session: AgentConversationSchema.optional(),
})
export type AgentConversationStatus = z.infer<typeof AgentConversationStatusSchema>

export const AgentConnectionSchema = z.object({
  /** 本机终端授权了哪一个已登记项目。 */
  projectId: z.string(),
  /** 当前仅提供实际接通的 Codex CLI。 */
  harness: z.literal('codex'),
  /** busy 时不接受另一轮发送，也不进入隐藏队列。 */
  availability: z.enum(['ready', 'busy']),
})
export type AgentConnection = z.infer<typeof AgentConnectionSchema>
