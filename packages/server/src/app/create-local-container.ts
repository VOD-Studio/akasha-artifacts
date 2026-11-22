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
  security?: HttpSecurityConfig
  clock?: Clock
  ids?: IdGenerator
}

// 手工装配本地容器：支持 SQLite 与内存双适配器，供本地 Daemon、契约测试与单元测试复用。
export function createLocalContainer(options: LocalContainerOptions = {}) {
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new CryptoIdGenerator()
  const realtime = new RealtimeEventHub({
    clock,
    maxHistory: options.maxEventHistory ?? 500,
  })
  const specs = new SpecRegistry()
  const checks = new CheckService(specs)
  const logs = new LogStore()

  const dbPath = options.dbPath ?? ':memory:'
  const sqlite = dbPath === 'memory' ? undefined : new SqliteStorage(dbPath)

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

  const startedAt = clock.now()
  const daemonState = {
    version: options.version ?? '0.1.0',
    pid: process.pid,
    port: options.port ?? 24321,
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
    security: options.security,
  })

  return {
    app,
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
