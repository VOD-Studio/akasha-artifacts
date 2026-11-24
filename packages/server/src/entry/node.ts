import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createLocalContainer, type LocalContainerOptions } from '../app/create-local-container.js'
import { attachNodeWebSocket } from '../interfaces/realtime/ws.js'

export interface NodeServerOptions extends LocalContainerOptions {
  // 缺省 127.0.0.1，只监听回环
  host?: string
}

/**
 * 启动本地 Daemon 的 HTTP 与 WebSocket 服务。
 *
 * @remarks 先等容器 `ready`（`.artifacts/` 启动期对账）再监听端口；`port` 传 `0` 时由系统分配，
 * 返回值里的 `port` 是实际端口。
 */
export async function startNodeServer(options: NodeServerOptions = {}) {
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 24321
  const container = createLocalContainer(options)
  try {
    await container.ready
  } catch (err) {
    container.close()
    throw err
  }
  const { artifacts } = container.repositories
  const isActive = async (id: string) =>
    (await artifacts.lifecycle.activeShareGeneration(id)) !== undefined
  const { injectWebSocket, wss } = attachNodeWebSocket(container.app, container.realtime, {
    authorizeSubscription: async (_request, { artifactId }) =>
      artifactId === undefined || isActive(artifactId),
    authorizeEvent: async (_request, _scope, event) =>
      event.type === 'artifact.metadata' || !event.artifactId || (await isActive(event.artifactId)),
  })

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const srv = serve(
      {
        fetch: container.app.fetch,
        hostname: host,
        port: requestedPort,
      },
      () => resolve(srv),
    )
    srv.on('error', reject)
  })

  injectWebSocket(server)

  const addr = server.address() as AddressInfo
  const actualPort = addr.port
  container.syncBoundPort(actualPort)
  container.logs.append({
    level: 'info',
    message: `Akasha 服务已启动于 http://${host}:${actualPort}`,
  })

  const close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // HTTP 的 closeAllConnections 不会关闭已升级的连接；开发重启不能等浏览器主动断开。
      for (const ws of wss.clients) ws.terminate()
      if ('closeAllConnections' in server && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
    })
    container.close()
  }

  return {
    ...container,
    server,
    host,
    port: actualPort,
    baseUrl: `http://${host}:${actualPort}`,
    wsUrl: `ws://${host}:${actualPort}/api/v1/ws`,
    close,
  }
}
