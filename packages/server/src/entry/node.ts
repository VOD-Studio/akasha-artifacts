import type { AddressInfo } from 'node:net'
import { serve } from '@hono/node-server'
import { createLocalContainer, type LocalContainerOptions } from '../app/create-local-container.js'
import { attachNodeWebSocket } from '../interfaces/realtime/ws.js'

export interface NodeServerOptions extends LocalContainerOptions {
  host?: string
}

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
  const { injectWebSocket } = attachNodeWebSocket(container.app, container.realtime)

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
