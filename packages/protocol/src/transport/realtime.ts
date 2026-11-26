import { z } from 'zod'
import { FeedbackSchema, JsonPatchOpSchema, ReviewRoundSchema, VersionSchema } from '../domain.js'
import { ISODateTimeSchema, PROTOCOL_VERSION, PublicIdSchema } from '../primitives.js'

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
 * @remarks 草稿与仅供讨论的意见均不产生 `feedback.created`。收到 `resync` 须整体重读。
 */
export const RealtimeServerEventSchema = z.discriminatedUnion('type', [
  // 任何途径写入新版本后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('version.created'),
    artifactId: PublicIdSchema,
    version: VersionSchema,
  }),
  // 展示元数据变更；客户端重读制品，不以头版本标题替代。
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('artifact.metadata'),
    artifactId: PublicIdSchema,
  }),
  // 状态流推进后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('state.patched'),
    artifactId: PublicIdSchema,
    // 状态流序号，与事件信封的 `seq` 无关
    stateSeq: z.number().int().min(1),
    ops: z.array(JsonPatchOpSchema).min(1),
  }),
  // 浏览器重读批注；不附正文，不唤醒 Agent
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('annotation.changed'),
    artifactId: PublicIdSchema,
  }),
  // 轮次开启、写入分组决定、提交或撤回后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('round.updated'),
    artifactId: PublicIdSchema,
    round: ReviewRoundSchema,
  }),
  // 非草稿反馈创建后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('feedback.created'),
    artifactId: PublicIdSchema,
    feedback: FeedbackSchema,
  }),
  // 回执确认导致反馈状态变化后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('feedback.updated'),
    artifactId: PublicIdSchema,
    feedback: FeedbackSchema,
  }),
  // Hook 上报后发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('agent.activity'),
    projectId: z.string().min(1),
    // 省略表示整个项目的状态
    artifactId: PublicIdSchema.optional(),
    state: AgentActivityStateSchema,
    summary: z.string().optional(),
  }),
  // 订阅该制品的连接数变化时发出
  z.object({
    ...EventEnvelopeBase,
    type: z.literal('presence.changed'),
    artifactId: PublicIdSchema,
    viewers: z.number().int().nonnegative(),
    agentOnline: z.boolean(),
  }),
  // 客户端游标超前于服务端，或已超出服务端保留的事件窗口
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
  // 两个范围字段都省略表示订阅全部
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('subscribe'),
    artifactId: PublicIdSchema.optional(),
    projectId: z.string().min(1).optional(),
    // 上次收到的事件序号；服务端据此补发其间的事件
    lastSeq: z.number().int().min(0).optional(),
  }),
  // 范围字段须与对应的 `subscribe` 一致
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('unsubscribe'),
    artifactId: PublicIdSchema.optional(),
    projectId: z.string().min(1).optional(),
  }),
  // 只回 `{ v, type: 'pong' }`，不属于 `RealtimeServerEvent`
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal('ping'),
  }),
])
export type RealtimeClientMessage = z.infer<typeof RealtimeClientMessageSchema>

const cursorEnvelope = { v: z.literal(PROTOCOL_VERSION) }
// 坐标以当前画布页面的世界像素计；不含视口位置、相机倍率或屏幕像素密度。
const cursorPoint = { x: z.number().finite(), y: z.number().finite() }

/** 临时光标独占一条绑定制品与页面的连接，不能发版本、订阅或替其他会话移动。 */
export const CanvasCursorInputSchema = z.discriminatedUnion('type', [
  z.object({ ...cursorEnvelope, type: z.literal('cursor.move'), ...cursorPoint }),
  z.object({ ...cursorEnvelope, type: z.literal('cursor.hide') }),
])
export type CanvasCursorInput = z.infer<typeof CanvasCursorInputSchema>

/** 不带 seq，不回放；peerId 只在该连接有效，匿名授权不附账号信息。 */
export const CanvasCursorEventSchema = z.discriminatedUnion('type', [
  z.object({ ...cursorEnvelope, type: z.literal('cursor.ready') }),
  z.object({
    ...cursorEnvelope,
    type: z.literal('cursor.moved'),
    peerId: z.uuid(),
    login: z.string().min(1).max(39).nullable(),
    ...cursorPoint,
  }),
  z.object({ ...cursorEnvelope, type: z.literal('cursor.left'), peerId: z.uuid() }),
])
export type CanvasCursorEvent = z.infer<typeof CanvasCursorEventSchema>
