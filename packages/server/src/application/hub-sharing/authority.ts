import type { ArtifactShareEntry, ArtifactShareInput, HubInviteTarget } from '@akasha/protocol'

/** `member` 是此次鉴权时的 Hub 成员资格，不能从历史邀请或客户端参数取得。 */
export interface HubPrincipal {
  kind: 'session' | 'cli'
  userId: string
  login: string
  member: boolean
}

/** 单次请求的分享权限；身份授权只在当前会话合成，不能作为持有者凭证签发。 */
export interface HubShareClaim {
  kind: 'share'
  artifactId: string
  role: ArtifactShareInput['role']
  entry: ArtifactShareEntry
  generation: number
  /** Unix 秒，与原有签名凭证的到期时间单位相同。 */
  exp: number
  /** 新持有者链接对应的持久化授权；历史签名没有此字段。 */
  grantId?: string
  /** 仅身份授权使用，批注可以据此归属于实际接受邀请的账号。 */
  boundUserId?: string
}

/** 组织或组以名字定位目录记录，授权绑定记录中的稳定身份。 */
export type HubAudienceTarget = Extract<HubInviteTarget, { kind: 'organization' | 'group' }>

/** 登录供应商是成员资格与已验证邮箱的权威来源；应用层不接触 OAuth 令牌。 */
export interface HubIdentityAuthority {
  readonly organization: string | undefined
  isAdministrator(principal: HubPrincipal): boolean
  lookupMember(
    principal: HubPrincipal,
    login: string,
  ): Promise<{ userId: string; login: string } | undefined>
  verifiedEmails(principal: HubPrincipal): Promise<readonly string[]>
  isInternalEmail(email: string): Promise<boolean>
  /** 只返回目录证实的组织或团队身份；同名的新受众不得继承旧授权。 */
  resolveAudienceId(principal: HubPrincipal, target: HubAudienceTarget): Promise<string | undefined>
  belongsTo(principal: HubPrincipal, target: HubAudienceTarget): Promise<boolean>
}
