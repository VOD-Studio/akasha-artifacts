import { z } from 'zod'
import {
  ArtifactSchema,
  CheckResultSchema,
  FeedbackSchema,
  JsonPatchOpSchema,
  ReviewRoundSchema,
  StateStreamSnapshotSchema,
  VerdictSchema,
  VersionSchema,
} from './domain.js'
import { ArtifactTypeSchema, PublicIdSchema, SlugSchema, VisibilitySchema } from './primitives.js'

// 支持用不可变 publicId 或可读 slug 定位 Artifact
export const ArtifactIdentifierSchema = z.union([PublicIdSchema, SlugSchema])
export type ArtifactIdentifier = z.infer<typeof ArtifactIdentifierSchema>

export const ArtifactPublishInputSchema = z.object({
  project: z.string().min(1).optional(),
  slug: SlugSchema,
  title: z.string().min(1),
  type: ArtifactTypeSchema,
  source: z.string(),
  baseVersion: z.number().int().min(1).optional(),
  visibility: VisibilitySchema.optional(),
})
export type ArtifactPublishInput = z.infer<typeof ArtifactPublishInputSchema>

export const ArtifactPublishOutputSchema = z.object({
  publicId: PublicIdSchema,
  slug: SlugSchema,
  version: z.number().int().min(1),
  url: z.url(),
  specHint: z.string().optional(),
})
export type ArtifactPublishOutput = z.infer<typeof ArtifactPublishOutputSchema>

export const TextEditSchema = z.object({
  old_str: z.string().min(1),
  new_str: z.string(),
})
export type TextEdit = z.infer<typeof TextEditSchema>

export const ArtifactUpdateInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  baseVersion: z.number().int().min(1),
  title: z.string().min(1).optional(),
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
  guide: z.string(),
  whitelist: z.array(z.string()),
  schema: z.record(z.string(), z.unknown()).optional(),
  example: z.string().optional(),
})
export type ArtifactSpecOutput = z.infer<typeof ArtifactSpecOutputSchema>

export const ArtifactPushStateInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  patch: z.array(JsonPatchOpSchema).min(1),
})
export type ArtifactPushStateInput = z.infer<typeof ArtifactPushStateInputSchema>

export const ArtifactPushStateOutputSchema = z.object({
  publicId: PublicIdSchema,
  seq: z.number().int().min(1),
})
export type ArtifactPushStateOutput = z.infer<typeof ArtifactPushStateOutputSchema>

export const ArtifactGetInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  version: z.number().int().min(1).optional(),
})
export type ArtifactGetInput = z.infer<typeof ArtifactGetInputSchema>

export const ArtifactGetOutputSchema = z.object({
  artifact: ArtifactSchema,
  version: VersionSchema,
  state: StateStreamSnapshotSchema,
  rounds: z.array(ReviewRoundSchema),
})
export type ArtifactGetOutput = z.infer<typeof ArtifactGetOutputSchema>

export const ArtifactPullFeedbackInputSchema = z.object({
  id: ArtifactIdentifierSchema.optional(),
  project: z.string().min(1).optional(),
  after: z.string().optional(),
  includeDrafts: z.boolean().optional().default(false),
  detail: z.boolean().optional().default(true),
})
export type ArtifactPullFeedbackInput = z.infer<typeof ArtifactPullFeedbackInputSchema>

export const ArtifactPullFeedbackOutputSchema = z.object({
  items: z.array(FeedbackSchema),
  rounds: z.array(ReviewRoundSchema),
  cursor: z.string(),
  // 仅 detail=true 时返回回执，预览拉取不推进消费游标
  receipt: z.string().min(1).optional(),
})
export type ArtifactPullFeedbackOutput = z.infer<typeof ArtifactPullFeedbackOutputSchema>

export const ArtifactAckFeedbackInputSchema = z.object({
  receipt: z.string().min(1),
  resolveIds: z.array(z.string().min(1)).optional(),
})
export type ArtifactAckFeedbackInput = z.infer<typeof ArtifactAckFeedbackInputSchema>

export const ArtifactAckFeedbackOutputSchema = z.object({
  acknowledged: z.number().int().min(0),
  resolved: z.number().int().min(0),
})
export type ArtifactAckFeedbackOutput = z.infer<typeof ArtifactAckFeedbackOutputSchema>

export const ArtifactAwaitFeedbackInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  after: z.string().optional(),
  // 上限 50 秒，低于常见 MCP 客户端工具调用超时
  timeoutSec: z.number().int().min(1).max(50).optional().default(45),
})
export type ArtifactAwaitFeedbackInput = z.infer<typeof ArtifactAwaitFeedbackInputSchema>

export const ArtifactAwaitFeedbackOutputSchema = z.object({
  status: z.enum(['received', 'pending']),
  items: z.array(FeedbackSchema),
  rounds: z.array(ReviewRoundSchema),
  cursor: z.string(),
  receipt: z.string().min(1).optional(),
})
export type ArtifactAwaitFeedbackOutput = z.infer<typeof ArtifactAwaitFeedbackOutputSchema>

export const ArtifactRecordVerdictInputSchema = z.object({
  id: ArtifactIdentifierSchema,
  project: z.string().min(1).optional(),
  roundId: z.string().min(1).optional(),
  groupId: z.string().min(1).optional(),
  choice: z.string().min(1).nullable().optional(),
  verdict: VerdictSchema.optional(),
  submitRound: z.boolean().optional(),
  note: z.string().optional(),
})
export type ArtifactRecordVerdictInput = z.infer<typeof ArtifactRecordVerdictInputSchema>

export const ArtifactRecordVerdictOutputSchema = z.object({
  round: ReviewRoundSchema,
})
export type ArtifactRecordVerdictOutput = z.infer<typeof ArtifactRecordVerdictOutputSchema>
