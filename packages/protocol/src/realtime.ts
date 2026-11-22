import { z } from 'zod'
import { FeedbackSchema, JsonPatchOpSchema, ReviewRoundSchema, VersionSchema } from './domain.js'
import { ISODateTimeSchema, PROTOCOL_VERSION, PublicIdSchema } from './primitives.js'

export const AgentActivityStateSchema = z.enum(['editing', 'idle', 'offline'])
export type AgentActivityState = z.infer<typeof AgentActivityStateSchema>

const EventEnvelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().min(1),
  timestamp: ISODateTimeSchema,
}

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
