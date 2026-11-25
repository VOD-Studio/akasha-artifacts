import type { HubGrantSummary, HubSharingOverride, HubSharingPolicy } from '@akasha/protocol'

/** 服务器保存的授权；制品撤下后旧代数永不生效。 */
export interface HubGrant extends Omit<HubGrantSummary, 'accepted'> {
  /** 与所有者管理或受邀者接受时使用的公共 ID 相同。 */
  artifactId: string
  /** 签发时的制品生命周期代数。 */
  generation: number
  /** 签发时锁定的 GitHub 成员 ID 或组织、团队的稳定实体键；邮箱和普通链接为 null。 */
  subjectId: string | null
  /** 成员与邮箱邀请首次成功接受后锁定；组织、组和外部链接不占用。 */
  acceptedUserId: string | null
}

/** 存储只保存经认证加密的供应商凭据与带密钥的邮箱索引，不能从表中直接使用 OAuth 凭据。 */
export interface HubIdentityStore {
  saveIdentitySecret(
    userId: string,
    ciphertext: string,
    emailKeys: readonly string[],
  ): Promise<void>
  getIdentitySecret(userId: string): Promise<string | undefined>
  findIdentityByEmailKey(key: string): Promise<string[]>
}

/** 单份制品的授权边界；历史制品省略时继承原有可见性与 Hub 默认策略。 */
export interface HubSharingScope {
  /** 永久停止从 team/public 可见性继承权限。 */
  restricted: boolean
  /** 各项为 null 时跟随 Hub 的对应策略。 */
  override: HubSharingOverride
}

/** SQLite、PostgreSQL 和内存容器共享的授权状态；无制品配置时保留历史可见性。 */
export interface HubSharingRepository extends HubIdentityStore {
  getDefaults(): Promise<HubSharingPolicy>
  /** 库批量读取候选集合的配置，未配置的 ID 不在结果中。 */
  getScopes(artifactIds: readonly string[]): Promise<ReadonlyMap<string, HubSharingScope>>
  setDefaults(policy: HubSharingPolicy): Promise<void>
  getScope(artifactId: string): Promise<HubSharingScope>
  setOverride(artifactId: string, override: HubSharingOverride): Promise<void>
  /** 在一个事务中切换为仅本人并移除所有当前授权，不清除管理员例外。 */
  restrictToOwner(artifactId: string): Promise<void>
  /** 原子写入；定向授权同时停止继承旧可见性，普通外链不改变旧可见性。 */
  createGrant(grant: HubGrant): Promise<void>
  listGrants(artifactId: string, generation: number): Promise<HubGrant[]>
  getGrant(id: string): Promise<HubGrant | undefined>
  /** 原子地绑定到一个账号；同一账号可重复接受，不能覆盖另一个账号。 */
  acceptGrant(id: string, userId: string): Promise<boolean>
  changeRole(artifactId: string, id: string, role: HubGrant['role']): Promise<boolean>
  revokeGrant(artifactId: string, id: string): Promise<boolean>
}

/** 应用层和登录模块共用有效策略；例外只覆盖对应的那个开关。 */
export async function effectiveSharingPolicy(
  repository: HubSharingRepository,
  artifactId: string,
): Promise<HubSharingPolicy> {
  const [defaults, { override }] = await Promise.all([
    repository.getDefaults(),
    repository.getScope(artifactId),
  ])
  return mergeSharingPolicy(defaults, override)
}

/** 分别应用两个制品级例外，未指定的方向继承 Hub 策略。 */
export function mergeSharingPolicy(
  defaults: HubSharingPolicy,
  override: HubSharingOverride,
): HubSharingPolicy {
  return {
    externalLinks: override.externalLinks ?? defaults.externalLinks,
    externalEmail: override.externalEmail ?? defaults.externalEmail,
  }
}
