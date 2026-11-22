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

export const ProjectSchema = z.object({
  id: z.string().min(1),
  rootPath: z.string().min(1),
  name: z.string().min(1),
  lastActiveAt: ISODateTimeSchema,
  dormant: z.boolean().optional(),
})
export type Project = z.infer<typeof ProjectSchema>

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

// RFC 6902 JSON Patch 六种原子操作
export const JsonPatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: JsonPointerSchema }),
  z.object({ op: z.literal('replace'), path: JsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal('move'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('copy'), from: JsonPointerSchema, path: JsonPointerSchema }),
  z.object({ op: z.literal('test'), path: JsonPointerSchema, value: z.unknown() }),
])
export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>

export const StatePatchSchema = z.object({
  artifactId: PublicIdSchema,
  ops: z.array(JsonPatchOpSchema).min(1),
})
export type StatePatch = z.infer<typeof StatePatchSchema>

export const StatePatchEntrySchema = z.object({
  seq: z.number().int().min(1),
  ops: z.array(JsonPatchOpSchema).min(1),
  createdAt: ISODateTimeSchema,
})
export type StatePatchEntry = z.infer<typeof StatePatchEntrySchema>

export const StateStreamSnapshotSchema = z.object({
  artifactId: PublicIdSchema,
  seq: z.number().int().min(0),
  snapshot: z.record(z.string(), z.unknown()),
  updatedAt: ISODateTimeSchema,
})
export type StateStreamSnapshot = z.infer<typeof StateStreamSnapshotSchema>

export const ElementRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})
export type ElementRect = z.infer<typeof ElementRectSchema>

// 元素定位契约：优先级 blockId > loc > selector > textPreview，至少须有一项非空
export const ElementRefSchema = z
  .object({
    blockId: z.string().min(1).optional(),
    loc: z
      .string()
      .regex(/^\d+:\d+(?:-\d+:\d+)?$/, 'loc 须为 line:col 或 line:col-line:col')
      .optional(),
    selector: z.string().min(1).optional(),
    rect: ElementRectSchema.optional(),
    textPreview: z.string().max(400).optional(),
  })
  .refine(
    (ref) => Boolean(ref.blockId || ref.loc || ref.selector || ref.textPreview),
    'ElementRef 至少须包含 blockId、loc、selector 或 textPreview 之一',
  )
export type ElementRef = z.infer<typeof ElementRefSchema>

export const VerdictSchema = z.enum(['pass', 'reject', 'waive'])
export type Verdict = z.infer<typeof VerdictSchema>

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

export const ReviewRoundStatusSchema = z.enum(['drafting', 'submitted', 'closed'])
export type ReviewRoundStatus = z.infer<typeof ReviewRoundStatusSchema>

export const ReviewRoundSchema = z.object({
  id: z.string().min(1),
  artifactId: PublicIdSchema,
  status: ReviewRoundStatusSchema,
  groups: z.array(ReviewGroupSchema),
  submittedAt: ISODateTimeSchema.nullable(),
  createdAt: ISODateTimeSchema,
})
export type ReviewRound = z.infer<typeof ReviewRoundSchema>

export const FeedbackKindSchema = z.enum([
  'comment',
  'approve',
  'request_changes',
  'vote',
  'pass',
  'reject',
  'waive',
  'edit',
  'runtime_error',
])
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>

export const FeedbackStatusSchema = z.enum(['pending', 'delivered', 'resolved'])
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>

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

export const ReceiptSchema = z.object({
  receipt: z.string().min(1),
  artifactId: PublicIdSchema.nullable(),
  cursor: z.string().min(1),
  feedbackIds: z.array(z.string().min(1)),
  issuedAt: ISODateTimeSchema,
})
export type Receipt = z.infer<typeof ReceiptSchema>

// L4 可视化直改原子操作：仅可作用于带静态 loc 的节点
const LocSchema = z
  .string()
  .regex(/^\d+:\d+(?:-\d+:\d+)?$/, 'loc 须为 line:col 或 line:col-line:col')

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

export const CheckDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string().min(1),
  message: z.string().min(1),
  line: z.number().int().min(1).optional(),
  column: z.number().int().min(1).optional(),
  suggestion: z.string().optional(),
})
export type CheckDiagnostic = z.infer<typeof CheckDiagnosticSchema>

export const CheckResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(CheckDiagnosticSchema),
  warnings: z.array(CheckDiagnosticSchema),
})
export type CheckResult = z.infer<typeof CheckResultSchema>
