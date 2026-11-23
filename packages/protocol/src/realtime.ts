import { z } from 'zod'
import { FeedbackSchema, JsonPatchOpSchema, ReviewRoundSchema, VersionSchema } from './domain.js'
import { ISODateTimeSchema, PROTOCOL_VERSION, PublicIdSchema } from './primitives.js'

/** Agent 活跃状态：`editing` 正在修改、`idle` 空闲待命、`offline` 离线。 */
export const AgentActivityStateSchema = z.enum(['editing', 'idle', 'offline'])
export type AgentActivityState = z.infer<typeof AgentActivityStateSchema>

// 服务端事件信封的公共字段：`seq` 为全局单调递增序号，重连时作为 `lastSeq` 续传
const EventEnvelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().min(1),
  timestamp: ISODateTimeSchema,
}

/**
 * 服务端 → 客户端的实时事件。
 *
 * @remarks 草稿反馈不产生 `feedback.created`；收到 `resync` 表示无法续传，须整体重读。
 */
export const RealtimeServerEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('version.created'),
    artifactId: PublicIdSchema,
    version: VersionSchema,
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('state.patched'),
    artifactId: PublicIdSchema,
    stateSeq: z.number().int().min(1),
    ops: z.array(JsonPatchOpSchema).min(1),
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('round.updated'),
    artifactId: PublicIdSchema,
    round: ReviewRoundSchema,
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('feedback.created'),
    artifactId: PublicIdSchema,
    feedback: FeedbackSchema,
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('feedback.updated'),
    artifactId: PublicIdSchema,
    feedback: FeedbackSchema,
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('agent.activity'),
    projectId: z.string().min(1),
    artifactId: PublicIdSchema.optional(),
    state: AgentActivityStateSchema,
    summary: z.string().optional(),
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('presence.changed'),
    artifactId: PublicIdSchema,
    viewers: z.number().int().nonnegative(),
    agentOnline: z.boolean(),
  }),
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('resync'),
    artifactId: PublicIdSchema.optional(),
    reason: z.string().min(1),
  }),
])
export type RealtimeServerEvent = z.infer<typeof RealtimeServerEventSchema>

/**
 * 客户端 → 服务端的实时消息。
 *
 * @remarks 解析失败的消息被静默丢弃，不回错误。
 */
export const RealtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('subscribe'),
    artifactId: PublicIdSchema.optional(),
    projectId: z.string().min(1).optional(),
    lastSeq: z.number().int().min(0).optional(),
  }),
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('unsubscribe'),
    artifactId: PublicIdSchema.optional(),
    projectId: z.string().min(1).optional(),
  }),
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('ping'),
  }),
])
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>
