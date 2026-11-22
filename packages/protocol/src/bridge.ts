import { z } from 'zod'
import { EditOpSchema, ElementRefSchema, JsonPatchOpSchema } from './domain.js'
import { ArtifactTypeSchema, PROTOCOL_VERSION } from './primitives.js'

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

export const StorageScopeSchema = z.enum(['private', 'shared'])
export type StorageScope = z.infer<typeof StorageScopeSchema>

// 外壳 → 沙盒
export const ShellToSandboxMessageSchema = z.discriminatedUnion('type', [
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('render'),
    artifactType: ArtifactTypeSchema,
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
    type: z.literal('apply.preview'),
    op: EditOpSchema,
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
  }),
  z.object({
    ...BridgeEnvelopeBase,
    type: z.literal('storage.request'),
    requestId: z.string().min(1),
    action: z.enum(['get', 'set', 'delete', 'list']),
    scope: StorageScopeSchema,
    key: z.string().optional(),
    prefix: z.string().optional(),
    value: z.unknown().optional(),
  }),
])
export type SandboxToShellMessage = z.infer<typeof SandboxToShellMessageSchema>
