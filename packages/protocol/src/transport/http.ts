import { z } from 'zod'
import type { ArtboardIndex } from '../artboard/projection.js'
import type {
  Artifact,
  ReviewRound,
  StateStreamSnapshot,
  Version,
  VersionSummary,
} from '../domain.js'
import { AuthorSchema, ISODateTimeSchema, PublicIdSchema, SlugSchema } from '../primitives.js'

/** 错误码；含义见行尾说明。 */
export const ERROR_CODES = [
  'BAD_REQUEST', // 参数或请求体不合法
  'UNAUTHORIZED', // 缺少或无法识别的凭据
  'FORBIDDEN', // 已认证但无权限，或 Host / Origin 校验失败
  'NOT_FOUND', // 资源或版本不存在
  'RESOURCE_CONFLICT', // 目标资源冲突，或操作期间资源归属已变化
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

/** 链接授予的角色，不改变 Hub 用户自身的团队权限。 */
export const ArtifactShareRoleSchema = z.enum(['view', 'comment', 'edit'])

/** 头版本入口、固定快照入口或固定快照中的试玩画板。 */
export const ArtifactShareEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact') }),
  z.object({ kind: z.literal('version'), version: z.number().int().positive() }),
  z.object({
    kind: z.literal('play'),
    version: z.number().int().positive(),
    // 空字符串表示总览或未分组页面。
    pageId: z.string().max(512),
    boardId: z.string().min(1).max(512),
  }),
])
export type ArtifactShareEntry = z.infer<typeof ArtifactShareEntrySchema>

/** 固定版本与画板均指向不可变快照；只有跟随头版本的入口可以授予编辑权。 */
export function canGrantShareRole(
  entry: ArtifactShareEntry,
  role: z.infer<typeof ArtifactShareRoleSchema>,
) {
  return role !== 'edit' || entry.kind === 'artifact'
}

/** 签发站内分享链接；链接默认为一天有效。 */
export const ArtifactShareInputSchema = z
  .object({
    role: ArtifactShareRoleSchema.default('comment'),
    entry: ArtifactShareEntrySchema.default({ kind: 'artifact' }),
    ttlSeconds: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60 * 60)
      .default(24 * 60 * 60),
  })
  .refine(({ entry, role }) => canGrantShareRole(entry, role), { path: ['role'] })
export type ArtifactShareInput = z.infer<typeof ArtifactShareInputSchema>

/** 仅分享访客的详情响应携带权限；不返回签名或会话凭证。 */
export interface ArtifactSharedAccess {
  role: z.infer<typeof ArtifactShareRoleSchema>
  /** 固定时只允许读取和讨论该快照；即使是 edit 角色也不能改写。 */
  version?: number
  expiresAt: string
}

/** 可分板的设计只返回布局和版本元数据；其他作品仍带单份源码。 */
export type WorkspaceVersion =
  | { version: VersionSummary; canvas: ArtboardIndex }
  | { version: Version; canvas?: undefined }

/** 打开工作台的首个读模型；分享视图不携带作者的运行状态或内部轮次。 */
export type ArtifactWorkspaceDetail = WorkspaceVersion & {
  artifact: Artifact
  state: StateStreamSnapshot
  rounds: readonly ReviewRound[]
  access?: ArtifactSharedAccess
  /** 受控设计的所有者也留在 Hub 工作区；个人预览才探测本机副本。 */
  hubRestricted?: true
}

/** 复制固定快照或把原制品移动到当前服务内已登记的项目。 */
export const ArtifactTransferInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('copy'),
    targetProjectId: z.string().min(1).max(256),
    version: z.number().int().positive(),
    slug: SlugSchema,
  }),
  z.object({
    kind: z.literal('move'),
    targetProjectId: z.string().min(1).max(256),
  }),
])
export type ArtifactTransferInput = z.infer<typeof ArtifactTransferInputSchema>
