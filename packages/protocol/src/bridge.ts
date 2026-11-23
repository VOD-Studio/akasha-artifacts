import { z } from 'zod'
import { EditOpSchema, ElementRectSchema, ElementRefSchema, JsonPatchOpSchema } from './domain.js'
import { ArtifactTypeSchema, PROTOCOL_VERSION } from './primitives.js'
import { ArtifactStorageOperationSchema } from './storage.js'

// 外壳与沙盒热更新时共享的视图与控件保态快照
export const PreservedViewStateSchema = z.object({
  activePage: z.string().optional(),
  scrollX: z.number().optional(),
  scrollY: z.number().optional(),
  zoom: z.number().positive().optional(),
  controls: z.record(z.string(), z.unknown()).optional(),
})
export type PreservedViewState = z.infer<typeof PreservedViewStateSchema>

const BridgeEnvelopeBase = {
  v: z.literal(PROTOCOL_VERSION),
  nonce: z.string().min(1),
}

// 外壳 → 沙盒
export const ShellToSandboxMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('render'),
    artifactType: ArtifactTypeSchema,
    boardId: z.string().min(1).optional(),
    version: z.number().int().min(1),
    source: z.string(),
    state: z.record(z.string(), z.unknown()),
    preservedState: PreservedViewStateSchema.optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('state'),
    seq: z.number().int().min(1),
    ops: z.array(JsonPatchOpSchema).min(1),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.start'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.stop'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('highlight'),
    element: ElementRefSchema.nullable(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('pins.track'),
    pins: z.array(
      z.object({
        id: z.string().min(1),
        element: ElementRefSchema,
      }),
    ),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('apply.preview'),
    op: EditOpSchema,
    version: z.number().int().positive(),
    source: z.string(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('apply.rollback'),
    version: z.number().int().positive(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('visual.inspect'),
    active: z.boolean(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('storage.response'),
    requestId: z.string().min(1),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
])
export type ShellToSandboxMessage = z.infer<typeof ShellToSandboxMessageSchema>

// 沙盒 → 外壳
export const SandboxToShellMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('ready'),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('rendered'),
    version: z.number().int().min(1),
    height: z.number().nonnegative().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('error'),
    phase: z.enum(['compile', 'runtime']),
    message: z.string().min(1),
    stack: z.string().optional(),
    loc: z.string().optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('resize'),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('viewState.snapshot'),
    state: PreservedViewStateSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.hover'),
    element: ElementRefSchema.nullable(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('inspect.select'),
    element: ElementRefSchema,
    // 区分用户真实点击选中（click）与滚动/缩放/高亮触发的几何坐标同步（sync）
    reason: z.enum(['click', 'sync']).optional(),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('pins.rects'),
    rects: z.record(z.string(), ElementRectSchema.nullable()),
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('storage.request'),
    requestId: z.string().min(1).max(64),
    operation: ArtifactStorageOperationSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('annotation.request'),
    version: z.number().int().positive(),
    element: ElementRefSchema,
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('visual.select'),
    version: z.number().int().positive(),
    element: ElementRefSchema,
    loc: z.string().optional(),
  }),
])
export type SandboxToShellMessage = z.infer<typeof SandboxToShellMessageSchema>
