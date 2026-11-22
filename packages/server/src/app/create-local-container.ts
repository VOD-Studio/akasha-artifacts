import { ArtifactService } from '../application/artifact-service.js'
import { CheckService } from '../application/check-service.js'
import { SpecRegistry } from '../application/spec-registry.js'
import type { Clock, IdGenerator } from '../domain/ports.js'
import { LogStore } from '../infrastructure/logging/log-store.js'
import { RealtimeEventHub } from '../infrastructure/realtime/event-hub.js'
import {
  CryptoIdGenerator,
  InMemoryArtifactRepository,
  InMemoryFeedbackRepository,
  InMemoryProjectRepository,
  InMemoryReceiptRepository,
  InMemoryRoundRepository,
  InMemoryStateRepository,
  SystemClock,
} from '../infrastructure/storage/memory/index.js'
import { SqliteStorage } from '../infrastructure/storage/sqlite/index.js'
import { createHttpApp, type HttpSecurityConfig } from '../interfaces/http/app.js'

export interface LocalContainerOptions {
  // 'memory' 走内存适配器；其它路径（含 ':memory:'）走 node:sqlite 适配器
  dbPath?: string
  version?: string
  port?: number
  sandboxPort?: number
  maxEventHistory?: number
  // 默认强制启用本地安全边界（Host/Origin/Token）；仅在需要自定义策略时覆写
  security?: HttpSecurityConfig
  clock?: Clock
  ids?: IdGenerator
}

function generateSecureToken(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildLoopbackHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]
}

export function buildLoopbackOrigins(port: number): string[] {
  return [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]
}

// 手工装配本地容器：默认启用 Host/Origin/Token 本地安全边界，支持 SQLite 与内存双适配器。
export function createLocalContainer(options: LocalContainerOptions = {}) {
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new CryptoIdGenerator()
  const specs = new SpecRegistry()
  const checks = new CheckService(specs)
  const logs = new LogStore()

  const dbPath = options.dbPath ?? ':memory:'
  const sqlite = dbPath === 'memory' ? undefined : new SqliteStorage(dbPath)

  // SQLite 重启时在历史 seq 基础上留出 1 个代差，确保重连客户端必定收到 resync 刷新缓存
  const persistedSeq = sqlite ? sqlite.getEventSeq() : 0
  const initialSeq = persistedSeq > 0 ? persistedSeq + 1 : 0
  if (sqlite && initialSeq > 0) {
    sqlite.setEventSeq(initialSeq)
  }

  const realtime = new RealtimeEventHub({
    clock,
    maxHistory: options.maxEventHistory ?? 500,
    initialSeq,
    onSeqAdvance: sqlite ? (seq) => sqlite.setEventSeq(seq) : undefined,
    resolveArtifactProject: sqlite ? (id) => sqlite.findProjectIdByArtifactSync(id) : undefined,
  })

  const projects = sqlite ? sqlite.projects : new InMemoryProjectRepository()
  const artifacts = sqlite ? sqlite.artifacts : new InMemoryArtifactRepository()
  const states = sqlite ? sqlite.states : new InMemoryStateRepository()
  const rounds = sqlite ? sqlite.rounds : new InMemoryRoundRepository()
  const feedbacks = sqlite ? sqlite.feedbacks : new InMemoryFeedbackRepository()
  const receipts = sqlite ? sqlite.receipts : new InMemoryReceiptRepository()

  const service = new ArtifactService({
    projects,
    artifacts,
    states,
    rounds,
    feedbacks,
    receipts,
    realtime,
    clock,
    ids,
  })

  const initialPort = options.port ?? 24321
  const token = options.security?.token ?? generateSecureToken()
  // 使用可变数组，便于 port=0 绑定真实端口后同步刷新 Host/Origin 白名单
  const allowedHosts = options.security?.allowedHosts
    ? [...options.security.allowedHosts]
    : buildLoopbackHosts(initialPort)
  const allowedOrigins = options.security?.allowedOrigins
    ? [...options.security.allowedOrigins]
    : buildLoopbackOrigins(initialPort)

  const security: HttpSecurityConfig = {
    token,
    cookieName: options.security?.cookieName ?? 'akasha_session',
    allowedHosts,
    allowedOrigins,
  }

  const startedAt = clock.now()
  const daemonState = {
    version: options.version ?? '0.1.0',
    pid: process.pid,
    port: initialPort,
    sandboxPort: options.sandboxPort ?? 24331,
    startedAt,
    relayState: 'local_only' as const,
    listLogs: (projectId?: string, limit?: number) => logs.list(projectId, limit),
    reportAgentActivity: (input: {
      projectId: string
      artifactId?: string
      state: 'editing' | 'idle' | 'offline'
      summary?: string
    }) => realtime.reportAgentActivity(input),
  }

  const app = createHttpApp({
    service,
    checks,
    specs,
    projects,
    artifacts,
    realtime,
    clock,
    daemon: daemonState,
    security,
  })

  const syncBoundPort = (actualPort: number) => {
    daemonState.port = actualPort
    if (!options.security?.allowedHosts) {
      allowedHosts.splice(0, allowedHosts.length, ...buildLoopbackHosts(actualPort))
    }
    if (!options.security?.allowedOrigins) {
      allowedOrigins.splice(0, allowedOrigins.length, ...buildLoopbackOrigins(actualPort))
    }
  }

  return {
    app,
    token,
    security,
    syncBoundPort,
    service,
    checks,
    specs,
    realtime,
    logs,
    daemonState,
    repositories: { projects, artifacts, states, rounds, feedbacks, receipts },
    close: () => {
      sqlite?.close()
    },
  }
}
