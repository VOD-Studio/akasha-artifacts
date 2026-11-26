import type { Artifact } from '@akasha/protocol'
import type { AgentSessions } from '../../application/agent-sessions.js'
import type { ArtifactService } from '../../application/artifact-service.js'
import type { CheckService } from '../../application/check-service.js'
import type { SpecRegistry } from '../../application/spec-registry.js'
import type { ArtifactStorageRepository } from '../../domain/artifact-storage.js'
import type {
  ArtifactRepository,
  Clock,
  ProjectRepository,
  RealtimeSubscriber,
} from '../../domain/ports.js'

/** 本地 Daemon 的安全边界配置；Hub 不传，改由 `mountHubGuard` 做同源与角色校验。 */
export interface HttpSecurityConfig {
  // 防 DNS rebinding：允许的 Host 头白名单（例如 ['localhost:24321', '127.0.0.1:24321']）
  allowedHosts?: readonly string[]
  // 写接口鉴权令牌（Bearer token 或同源 session cookie）
  token?: string
  // 承载 token 的 cookie 名，缺省 akasha_session
  cookieName?: string
  // 跨站写请求 Origin 白名单
  allowedOrigins?: readonly string[]
}

/** 状态、日志与活跃状态接口的数据来源；本地由容器提供，Hub 以固定值填充。 */
export interface DaemonInfoProvider {
  version: string
  pid: number
  port: number
  sandboxPort: number
  startedAt: string
  relayState: 'local_only' | 'connected' | 'degraded' | 'rate_limited'
  listLogs: (projectId?: string, limit?: number) => readonly unknown[]
  reportAgentActivity: (input: {
    projectId: string
    artifactId?: string
    state: 'editing' | 'idle' | 'offline'
    summary?: string
  }) => Promise<void>
  // 省略时 shutdown 接口只应答，不做任何事
  requestShutdown?: () => void
}

export interface HttpAppDeps {
  service: ArtifactService
  checks: CheckService
  specs: SpecRegistry
  projects: ProjectRepository
  artifacts: ArtifactRepository
  realtime: RealtimeSubscriber
  clock: Clock
  daemon: DaemonInfoProvider
  security?: HttpSecurityConfig
  // 省略时制品存储接口返回 404
  artifactStorage?: ArtifactStorageRepository
  // 只在专用会话凭证通过后按当前 Hub 目录核实项目所有者。
  codingOwnerActive?: (project: string) => Promise<boolean>
  // 从请求解析制品存储的调用方身份；null 表示未登录。省略时视为本地单一用户
  storagePrincipal?: (request: Request) => Promise<string | null>
  // 收藏保留用户意愿，但列出时仍须检查当前权限；本地只验证制品仍存在。
  filterVisibleFavorites?: (
    request: Request,
    candidates: readonly Artifact[],
  ) => Promise<readonly Artifact[]>
  // 仅装配本机 CLI 的容器提供。
  agentSessions?: AgentSessions
}
