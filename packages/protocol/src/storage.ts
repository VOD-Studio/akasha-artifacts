import { z } from 'zod'

/** 制品存储的作用域：`private` 仅当前登录用户，`shared` 对所有可访问者共享。 */
export const StorageScopeSchema = z.enum(['private', 'shared'])
export type StorageScope = z.infer<typeof StorageScopeSchema>

/** 制品存储配额：单个键、单个值、单个作用域各自的字节数上限，以及单作用域的键数上限。 */
export const ARTIFACT_STORAGE_LIMITS = {
  keyBytes: 128,
  valueBytes: 16 * 1024,
  scopeBytes: 64 * 1024,
  entries: 128,
} as const

const key = z.string().min(1).max(ARTIFACT_STORAGE_LIMITS.keyBytes)
const scope = StorageScopeSchema

/**
 * 沙盒经 Bridge 提出的制品存储操作，由外壳代办；沙盒不直接联网。
 *
 * @remarks 超出配额返回 `BAD_REQUEST`；未登录访问 `private` 返回 `UNAUTHORIZED`。
 */
export const ArtifactStorageOperationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('get'), scope, key }),
  z.object({
    action: z.literal('set'),
    scope,
    key,
    // 须可 JSON 序列化；`undefined` 不合法
    value: z.unknown().refine((v) => v !== undefined),
  }),
  z.object({ action: z.literal('delete'), scope, key }),
  z.object({
    action: z.literal('list'),
    scope,
    // 只列出以它开头的键
    prefix: z.string().max(ARTIFACT_STORAGE_LIMITS.keyBytes).optional(),
  }),
])
export type ArtifactStorageOperation = z.infer<typeof ArtifactStorageOperationSchema>

/** 只公开按既有配额算法计算的字节数，不包含键或值。 */
export const ArtifactStorageUsageSchema = z.object({
  sharedBytes: z.number().int().nonnegative(),
  // null 表示当前请求没有个人命名空间
  privateBytes: z.number().int().nonnegative().nullable(),
  limitPerScopeBytes: z.number().int().positive(),
})
export type ArtifactStorageUsage = z.infer<typeof ArtifactStorageUsageSchema>
