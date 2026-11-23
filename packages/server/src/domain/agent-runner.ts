/** 本地 Daemon 授权给一个 CLI 轮次的执行参数，绝不来自浏览器的进程配置。 */
export interface AgentRunnerLaunch {
  /** 已登记并由本机终端授权的项目路径。 */
  root: string
  /** 真实发布线程；缺省时才启动新会话。 */
  threadId?: string
  /** 用户文字和经过校验的制品快照引用。 */
  prompt: string
  /** 仅此轮次生效，不能认证到普通 Daemon API。 */
  token: string
  /** 同一 Daemon 的回环地址，由服务端生成。 */
  baseUrl: string
  /** 作为 CLI 发布的默认项目，不允许工具自己换项目。 */
  projectId: string
  /** 断开授权、关闭服务或执行超时会中止进程。 */
  signal: AbortSignal
  /** 只从可信的 CLI 事件来建立或确认线程绑定。 */
  onThread: (id: string) => void
}

/** 操作真实 CLI 的本机端口；会话服务不管理进程和 CLI 登录配置。 */
export interface AgentRunner {
  /** 从同一 CLI 查版本和登录状态；连接失败时不授予执行权限。 */
  check(root: string): Promise<void>
  /** 成功时返回实际 CLI 最后一条助手消息，而不是工具回执。 */
  run(request: AgentRunnerLaunch): Promise<string>
}
