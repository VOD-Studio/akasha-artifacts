import { z } from 'zod'
import { AuthorSchema, ISODateTimeSchema, PublicIdSchema } from './primitives.js'

/** 错误码；含义见行尾说明。 */
export const ERROR_CODES = [
  'BAD_REQUEST', // 参数或请求体不合法
  'UNAUTHORIZED', // 缺少或无法识别的凭据
  'FORBIDDEN', // 已认证但无权限，或 Host / Origin 校验失败
  'NOT_FOUND', // 资源或版本不存在
  'VERSION_CONFLICT', // `baseVersion` 落后于头版本，`details` 为 `VersionConflictDetails`
  'AMBIGUOUS_MATCH', // `old_str` 在源码中匹配到多处
  'MATCH_NOT_FOUND', // `old_str` 在源码中零匹配
  'PATCH_FAILED', // JSON Patch 应用失败，`details` 含 `opIndex` 与 `op`
  'ROUND_LOCKED', // 轮次已提交或关闭，不可再修改
  'INVALID_RECEIPT', // 回执无效或已被消费
  'RATE_LIMITED', // 请求过于频繁
  'INTERNAL_ERROR', // 未归类的服务端异常
] as const

export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const VersionConflictDetailsSchema = z.object({
  // 冲突的制品
  artifactId: PublicIdSchema,
  // 写入方声明的基准版本
  baseVersion: z.number().int().min(1),
  // 当前头版本
  headVersion: z.number().int().min(1),
  // 从 `baseVersion` 到 `headVersion` 的统一 diff；两者源码相同时为空串
  diff: z.string(),
  // 期间产生版本的作者，已去重
  authors: z.array(AuthorSchema),
})
export type VersionConflictDetails = z.infer<typeof VersionConflictDetailsSchema>

/** 所有错误响应的统一信封。 */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    // 面向人的中文说明
    message: z.string().min(1),
    // 各错误码自行约定的补充信息
    details: z.unknown().optional(),
  }),
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>

export const DaemonStatusSchema = z.object({
  status: z.enum(['running', 'stopping']),
  version: z.string().min(1),
  pid: z.number().int().positive(),
  // 服务端监听端口，与外壳同源
  port: z.number().int().min(1).max(65535),
  // 沙盒静态资源的端口
  sandboxPort: z.number().int().min(1).max(65535),
  uptimeSec: z.number().nonnegative(),
  projectCount: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  // 本地为 `local_only`，Hub 为 `connected`
  relayState: z.enum(['local_only', 'connected', 'degraded', 'rate_limited']),
  startedAt: ISODateTimeSchema,
})
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string().min(1),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
