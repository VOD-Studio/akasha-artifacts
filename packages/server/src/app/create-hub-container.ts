import { PROTOCOL_VERSION } from '@akasha/protocol'
import { Hono } from 'hono'
import { ArtifactService, type ArtifactServiceDeps } from '../application/artifact-service.js'
import { CheckService } from '../application/check-service.js'
import { SpecRegistry } from '../application/spec-registry.js'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import type { RealtimePublisher, RealtimeSubscriber } from '../domain/ports.js'
import { CryptoIdGenerator, SystemClock } from '../infrastructure/storage/memory/index.js'
import { createHttpApp } from '../interfaces/http/app.js'
import { createHubAccess } from '../interfaces/http/hub-access.js'
import { createHubAuth, type HubOAuthOptions } from '../interfaces/http/hub-auth.js'
import { mountHubGuard } from '../interfaces/http/hub-guard.js'
import { validateHubOrigins } from './hub-origins.js'

export interface HubContainerOptions {
  repositories: Pick<
    ArtifactServiceDeps,
    'projects' | 'artifacts' | 'states' | 'rounds' | 'feedbacks' | 'receipts'
  >
  // 须同时支持发布与订阅
  realtime: RealtimePublisher & RealtimeSubscriber
  clock?: ArtifactServiceDeps['clock']
  ids?: ArtifactServiceDeps['ids']
  // Hub 的 origin，须为无路径的 HTTPS origin
  origin: string
  // 沙盒的 origin，须与 Hub 使用不同的注册域名
  sandboxOrigin: string
  oauth: HubOAuthOptions
  // 省略时制品存储接口返回 404
  artifactStorage?: ArtifactStorageRepository
}

/**
 * 手工装配 Hub 容器：在通用接口之外挂载鉴权、访问控制与 Hub 守卫。
 *
 * @throws {Error} `origin` 或 `sandboxOrigin` 不合法，或两者注册域名相同。
 */
export function createHubContainer(options: HubContainerOptions) {
  validateHubOrigins(options.origin, options.sandboxOrigin)
  const hubUrl = new URL(options.origin)
  const sandboxUrl = new URL(options.sandboxOrigin)
  const origin = hubUrl.origin
  const clock = options.clock ?? new SystemClock()
  const ids = options.ids ?? new CryptoIdGenerator()
  const { repositories, realtime } = options
  const service = new ArtifactService({ ...repositories, realtime, clock, ids })
  const auth = createHubAuth(options.oauth, origin, clock, repositories.receipts)
  const access = createHubAccess(repositories.artifacts, auth, origin)
  const specs = new SpecRegistry()
  const core = createHttpApp({
    service,
    checks: new CheckService(specs),
    specs,
    projects: repositories.projects,
    artifacts: repositories.artifacts,
    realtime,
    clock,
    daemon: {
      version: `hub/${PROTOCOL_VERSION}`,
      pid: 0,
      port: Number(hubUrl.port || (hubUrl.protocol === 'https:' ? 443 : 80)),
      sandboxPort: Number(sandboxUrl.port || (sandboxUrl.protocol === 'https:' ? 443 : 80)),
      startedAt: clock.now(),
      relayState: 'connected',
      listLogs: () => [],
      reportAgentActivity: (input) =>
        realtime.publish({ type: 'agent.activity', ...input }, { projectId: input.projectId }),
    },
    artifactStorage: options.artifactStorage,
    storagePrincipal: async (request) => (await auth.authenticate(request))?.userId ?? null,
  })
  const app = new Hono()
  mountHubGuard(app, { core, auth, access, repositories, origin, clock, ids })
  return {
    app,
    service,
    authenticate: auth.authenticate,
    authorizeArtifact: access.authorizeArtifact,
    authorizeRealtime: access.authorizeRealtime,
    authorizeRealtimeEvent: access.authorizeRealtimeEvent,
  }
}
