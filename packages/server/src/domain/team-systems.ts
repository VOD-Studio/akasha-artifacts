import type { SystemPublicationAction } from '@akasha/protocol'

/** 授权仅适用于来源项目中的这份不可变设计系统版本，不随头版本更新。 */
export interface NamedSystemPin {
  /** 授权时系统所属的项目，不是使用该系统的目标项目。 */
  projectId: string
  /** 设计系统制品的公共 ID。 */
  id: string
  /** 已审阅的固定版本号。 */
  version: number
  /** 授权时的分享代数；撤下再恢复不会复用旧代数。 */
  generation: number
}

/** 授权按稳定账号绑定，登录名只供所有者查看与管理名单。 */
export interface NamedSystemMember {
  /** 已核实的 GitHub 账号 ID，不因改名而变更。 */
  userId: string
  /** 设置名单时核实的 GitHub 登录名。 */
  login: string
}

/** 团队发布状态独立于点名授权；撤回记录保留到本代生命周期结束。 */
export interface SystemPublication extends NamedSystemPin {
  /** 为 true 时阻止这个版本用于新的生成，包括由所有者发起的生成。 */
  withdrawn: boolean
  /** 整个 Hub 至多一个已发布且未撤回的固定版本为默认。 */
  isDefault: boolean
}

/** 名单只授予使用固定版本的资格，不改变制品或项目的读取权限。 */
export interface NamedSystemRepository {
  /** 只列当前项目归属与代数仍匹配、且显式授予这个账号的版本。 */
  listNamed(userId: string): Promise<NamedSystemPin[]>
  /** 读取该来源、版本与代数的完整名单，按设置时的顺序返回。 */
  getMembers(pin: NamedSystemPin): Promise<NamedSystemMember[]>
  /** 原子替换整个名单；传空数组撤销全部定向授权，账号 ID 不得重复。 */
  setMembers(pin: NamedSystemPin, members: NamedSystemMember[]): Promise<void>
  /** 只列当前归属与代数仍匹配的发布记录，包含已撤回版本。 */
  listPublications(): Promise<SystemPublication[]>
  /** 未发布或不再属于当前生命周期时没有记录。 */
  publication(pin: NamedSystemPin): Promise<SystemPublication | undefined>
  /** 默认切换在整个 Hub 内互斥；版本不再有效或不能执行该转换时返回 false。 */
  setPublication(pin: NamedSystemPin, action: SystemPublicationAction): Promise<boolean>
  /** 账号未设置时继承团队默认系统；这一偏好与当前默认版本无关。 */
  inheritDefault(userId: string): Promise<boolean>
  /** 调用方须从认证身份取得账号 ID；修改个人偏好不会改变团队默认版本。 */
  setInheritDefault(userId: string, enabled: boolean): Promise<void>
}
