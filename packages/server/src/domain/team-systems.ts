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

/** 名单只授予使用固定版本的资格，不改变制品或项目的读取权限。 */
export interface NamedSystemRepository {
  /** 只列当前项目归属与代数仍匹配、且显式授予这个账号的版本。 */
  listNamed(userId: string): Promise<NamedSystemPin[]>
  /** 读取该来源、版本与代数的完整名单，按设置时的顺序返回。 */
  getMembers(pin: NamedSystemPin): Promise<NamedSystemMember[]>
  /** 原子替换整个名单；传空数组撤销全部定向授权，账号 ID 不得重复。 */
  setMembers(pin: NamedSystemPin, members: NamedSystemMember[]): Promise<void>
}
