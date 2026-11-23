import path from 'node:path'
import { ArtifactService } from '../application/artifact-service.js'
import { CheckService } from '../application/check-service.js'
import { SpecRegistry } from '../application/spec-registry.js'
import type { Clock, IdGenerator } from '../domain/ports.js'
import { LogStore } from '../infrastructure/logging/log-store.js'
import { RealtimeEventHub } from '../infrastructure/realtime/event-hub.js'
import {
  FsArtifactsStorage,
  resolveArtifactFileLayout,
} from '../infrastructure/storage/fs/index.js'
import { FsArtifactsWatcher } from '../infrastructure/storage/fs/watcher.js'
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
  // 存储模式：默认 sqlite；选 fs 时使用项目内 .artifacts/ 原生文件存储适配器
  storageMode?: 'sqlite' | 'fs'
  // fs 模式下 .artifacts/ 目录路径（默认 <cwd>/.artifacts）
  artifactsDir?: string
  // fs 模式下关联的项目 ID 与项目根路径（独立于 artifactsDir，兼容嵌套或外部产物目录）
  fsProjectId?: string
  fsProjectRoot?: string
  fsWatchDebounceMs?: number
  // 'memory' 走内存适配器；其它路径（含 ':memory:'）走 node:sqlite 适配器
  dbPath?: string
  version?: string
  port?: number
  sandboxPort?: number
  maxEventHistory?: number
  // 默认强制启用本地安全边界（Host/Origin/Token）；仅在需要自定义策略时覆写
  security?: HttpSecurityConfig
  onShutdown?: () => void
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

  const storageMode = options.storageMode ?? 'sqlite'
  const dbPath = options.dbPath ?? ':memory:'
  const fsStorage =
    storageMode === 'fs'
      ? new FsArtifactsStorage({
          artifactsRoot: path.resolve(
            options.artifactsDir ?? path.join(process.cwd(), '.artifacts'),
          ),
          projectRoot: options.fsProjectRoot,
          projectId: options.fsProjectId,
        })
      : undefined
  const sqlite = fsStorage || dbPath === 'memory' ? undefined : new SqliteStorage(dbPath)
  const persistentBackend = fsStorage ?? sqlite

  // 持久化存储重启时在历史 seq 基础上留出 1 个代差，确保重连客户端必定收到 resync 刷新缓存
  const persistedSeq = persistentBackend ? persistentBackend.getEventSeq() : 0
  const initialSeq = persistedSeq > 0 ? persistedSeq + 1 : 0
  if (persistentBackend && initialSeq > 0) {
    persistentBackend.setEventSeq(initialSeq)
  }

  const realtime = new RealtimeEventHub({
    clock,
    maxHistory: options.maxEventHistory ?? 500,
    initialSeq,
    onSeqAdvance: persistentBackend ? (seq) => persistentBackend.setEventSeq(seq) : undefined,
    resolveArtifactProject: persistentBackend
      ? (id) => persistentBackend.findProjectIdByArtifactSync(id)
      : undefined,
  })

  // 当服务端写入前检测到尚未经防抖监听器入库的外部磁盘改动时，同步广播其补录的 version.created 事件
  fsStorage?.artifacts.setOnDiskReconciled((artifact, version) => {
    void realtime.publish(
      {
        type: 'version.created',
        artifactId: artifact.publicId,
        version,
      },
      { projectId: artifact.projectId },
    )
  })

  const projects = persistentBackend ? persistentBackend.projects : new InMemoryProjectRepository()
  const artifacts = persistentBackend
    ? persistentBackend.artifacts
    : new InMemoryArtifactRepository()
  const states = persistentBackend ? persistentBackend.states : new InMemoryStateRepository()
  const rounds = persistentBackend ? persistentBackend.rounds : new InMemoryRoundRepository()
  const feedbacks = persistentBackend
    ? persistentBackend.feedbacks
    : new InMemoryFeedbackRepository()
  const receipts = persistentBackend ? persistentBackend.receipts : new InMemoryReceiptRepository()

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

  // .artifacts/ 原生文件模式下启用文件监听：外部编辑自动生成新版本并广播到 WS（保态重绘）
  const fsProjectId = fsStorage?.projectId ?? options.fsProjectId ?? 'default'
  let containerClosed = false
  const fsWatcher = fsStorage
    ? new FsArtifactsWatcher({
        artifactsRoot: fsStorage.artifactsRoot,
        debounceMs: options.fsWatchDebounceMs ?? 120,
        isOwnWrite: (filePath, content) => fsStorage.artifacts.isOwnWrite(filePath, content),
        onError: (err) => {
          if (containerClosed) return
          logs.append({
            level: 'warn',
            projectId: fsProjectId,
            message: `.artifacts 文件监听异常：${err instanceof Error ? err.message : String(err)}`,
          })
        },
        onExternalFileChange: async (evt) => {
          if (containerClosed) return
          // 1. 优先按 .artifact-id 定位既有 Artifact（支持目录重命名/移动后保持稳定 publicId）
          let existing = evt.existingPublicId
            ? await artifacts.findByPublicId(evt.existingPublicId)
            : undefined
          if (!existing) {
            existing = await artifacts.findBySlug(fsProjectId, evt.slug)
          }
          // 兼容单段 slug（如 card 落盘在 html/card/）在缺少 .artifact-id 时仍能匹配回原记录
          if (!existing && evt.slug.startsWith(`${evt.type}/`)) {
            const shortSlug = evt.slug.slice(evt.type.length + 1)
            const candidate = await artifacts.findBySlug(fsProjectId, shortSlug)
            if (candidate && candidate.type === evt.type) {
              existing = candidate
            }
          }

          if (existing) {
            // 在与 publish/update/revert 相同的 Artifact 写锁内重读最新记录并完成目录改名元数据对账，
            // 确保 headVersion 单调不回退；退出锁后再按需调用 service.publish 避免嵌套死锁。
            const reconciled = await service.withArtifactLock(existing.publicId, async () => {
              let fresh = await artifacts.findByPublicId(existing.publicId)
              if (!fresh) return null

              const existingLayout = resolveArtifactFileLayout(
                fsStorage.artifactsRoot,
                fresh.type,
                fresh.slug,
              )
              const typeChanged = fresh.type !== evt.type
              const dirMoved =
                path.resolve(existingLayout.artifactDir) !== path.resolve(evt.artifactDir) ||
                typeChanged
              let metadataUpdated = false
              if (dirMoved && (fresh.slug !== evt.slug || typeChanged)) {
                const conflictBySlug = await artifacts.findBySlug(fresh.projectId, evt.slug)
                if (!conflictBySlug || conflictBySlug.publicId === fresh.publicId) {
                  fresh = await fsStorage.artifacts.updateIndexOnly({
                    ...fresh,
                    slug: evt.slug,
                    type: evt.type,
                    updatedAt: clock.now(),
                  })
                  metadataUpdated = true
                }
              }
              const headVer = await artifacts.getVersion(fresh.publicId, fresh.headVersion)
              return { fresh, headVer, typeChanged, metadataUpdated }
            })
            if (!reconciled) return

            const { fresh, headVer, typeChanged, metadataUpdated } = reconciled
            if (!typeChanged && headVer && headVer.source === evt.source) {
              fsStorage.artifacts.recordSyncedContent(evt.entryFile, evt.source)
              if (metadataUpdated) {
                // 目录改名但源码未变时主动通知在线客户端刷新缓存中的 slug/元数据
                await realtime.publish(
                  {
                    type: 'version.created',
                    artifactId: fresh.publicId,
                    version: headVer,
                  },
                  { projectId: fresh.projectId },
                )
              }
              return
            }
            await service.publish({
              projectId: fresh.projectId,
              slug: fresh.slug,
              title: fresh.title,
              type: evt.type,
              source: evt.source,
              baseVersion: fresh.headVersion,
              author: 'agent:fs',
            })
            fsStorage.artifacts.recordSyncedContent(evt.entryFile, evt.source)
            return
          }

          // 2. 外部宿主工具新建或 Git 检出的文件：自动建档；若已带合法 .artifact-id 则保留原 publicId 避免索引重建破坏书签
          fsStorage.artifacts.markImportingExternalFile(evt.entryFile, evt.slug, evt.source)
          const slugTitle = path.basename(evt.slug) || evt.slug
          try {
            await service.publish({
              projectId: fsProjectId,
              slug: evt.slug,
              title: slugTitle,
              type: evt.type,
              source: evt.source,
              author: 'agent:fs',
              preferredPublicId: evt.existingPublicId,
            })
            fsStorage.artifacts.recordSyncedContent(evt.entryFile, evt.source)
          } finally {
            fsStorage.artifacts.clearImportingExternalFile(evt.entryFile)
          }
        },
      })
    : undefined

  fsWatcher?.start()
  // 启动期立即全量对账既有 .artifacts/ 文件（覆盖停机期间的外部编辑或 Git checkout）；
  // startNodeServer 会在监听端口前 await ready，确保首批请求绝不读到过期快照或覆写离线修改。
  const ready: Promise<void> = fsWatcher
    ? fsWatcher
        .scanAll()
        .then(() => undefined)
        .catch((err) => {
          logs.append({
            level: 'warn',
            projectId: fsProjectId,
            message: `.artifacts 启动期全量对账异常：${err instanceof Error ? err.message : String(err)}`,
          })
        })
    : Promise.resolve()

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
    requestShutdown: options.onShutdown,
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
    fsStorage,
    fsWatcher,
    ready,
    repositories: { projects, artifacts, states, rounds, feedbacks, receipts },
    close: () => {
      containerClosed = true
      fsWatcher?.close()
      fsStorage?.close()
      sqlite?.close()
    },
  }
}
