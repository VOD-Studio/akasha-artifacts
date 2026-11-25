import { z } from 'zod'
import { type ArtifactShareInput, ArtifactShareRoleSchema } from './http.js'

/** 点名成员绑定 GitHub 数字 ID；组是已配置组织中的 GitHub team slug。 */
export const HubInviteTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('member'),
    login: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9-]{1,39}$/),
  }),
  z.object({ kind: z.literal('email'), email: z.email().max(254).toLowerCase() }),
  z.object({ kind: z.literal('organization') }),
  z.object({
    kind: z.literal('group'),
    slug: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_-]{1,100}$/),
  }),
])
export type HubInviteTarget = z.infer<typeof HubInviteTargetSchema>

/** 定向邀请只打开头版本；固定版本或画板使用现有链接入口。 */
export const HubInviteInputSchema = z.object({
  target: HubInviteTargetSchema,
  role: ArtifactShareRoleSchema,
  ttlSeconds: z
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60 * 60),
})
export type HubInviteInput = z.infer<typeof HubInviteInputSchema>

/** 两种外发授权独立；组织成员访问不由外发开关控制。 */
export const HubSharingPolicySchema = z.object({
  externalLinks: z.boolean(),
  externalEmail: z.boolean(),
})
export type HubSharingPolicy = z.infer<typeof HubSharingPolicySchema>

/** `null` 继承 Hub 默认值；例外只作用于一个制品。 */
export const HubSharingOverrideSchema = z.object({
  externalLinks: z.boolean().nullable(),
  externalEmail: z.boolean().nullable(),
})
export type HubSharingOverride = z.infer<typeof HubSharingOverrideSchema>

/** 仅所有者可列出邀请；不返回签名、已验证邮箱列表或被邀请者的凭据。 */
export interface HubGrantSummary {
  id: string
  target: HubInviteTarget | { kind: 'link' }
  /** 定向邀请跟随头版本；普通链接也可固定到某个版本或其中的画板。 */
  entry: ArtifactShareInput['entry']
  role: ArtifactShareInput['role']
  expiresAt: string
  /** 只对点名和邮箱邀请表示已由正确的账户接受。 */
  accepted: boolean
}

/** 所有者的分享设置；`restricted` 表示不再继承原有的 team/public 可见性。 */
export interface HubArtifactSharing {
  restricted: boolean
  organization: string | null
  policy: HubSharingPolicy
  grants: HubGrantSummary[]
}

/** 只有部署指定的管理员可读取或修改此设置，不因此获得制品内容。 */
export interface HubAdminSharingPolicy {
  defaults: HubSharingPolicy
  override: HubSharingOverride
}
