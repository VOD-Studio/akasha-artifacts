import { z } from 'zod'

export const StorageScopeSchema = z.enum(['private', 'shared'])
export type StorageScope = z.infer<typeof StorageScopeSchema>

export const ARTIFACT_STORAGE_LIMITS = {
  keyBytes: 128,
  valueBytes: 16 * 1024,
  scopeBytes: 64 * 1024,
  entries: 128,
} as const

const key = z.string().min(1).max(ARTIFACT_STORAGE_LIMITS.keyBytes)
const scope = StorageScopeSchema

export const ArtifactStorageOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'), scope, key }),
  z.object({
    action: z.literal('set'),
    scope,
    key,
    value: z.unknown().refine((v) => v !== undefined),
  }),
  z.object({ action: z.literal('delete'), scope, key }),
  z.object({
    action: z.literal('list'),
    scope,
    prefix: z.string().max(ARTIFACT_STORAGE_LIMITS.keyBytes).optional(),
  }),
])
export type ArtifactStorageOperation = z.infer<typeof ArtifactStorageOperationSchema>
