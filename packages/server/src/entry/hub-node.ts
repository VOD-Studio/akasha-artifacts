import { once } from 'node:events'
import fs from 'node:fs'
import type { Socket } from 'node:net'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createHubContainer, type HubContainerOptions } from '../app/create-hub-container.js'
import { RealtimeEventHub } from '../infrastructure/realtime/event-hub.js'
import { SystemClock } from '../infrastructure/storage/memory/index.js'
import { createPostgresStorage } from '../infrastructure/storage/postgres/index.js'
import { createS3Blobs, type S3BlobsOptions } from '../infrastructure/storage/s3/index.js'
import { createSqliteHubStorage } from '../infrastructure/storage/sqlite/hub-storage.js'
import { attachNodeWebSocket } from '../interfaces/realtime/ws.js'

interface NodeHubOptions {
  host: string
  port: number
  webDir: string
  origin: string
  sandboxOrigin: string
  dbPath: string
  connectionString?: string
  s3?: S3BlobsOptions
  oauth: HubContainerOptions['oauth']
}

export async function startNodeHub(options: NodeHubOptions) {
  const index = fs.readFileSync(path.join(options.webDir, 'index.html'), 'utf8')
  const blobs = options.s3 ? createS3Blobs(options.s3) : undefined
  const storage = options.connectionString
    ? createPostgresStorage({ connectionString: options.connectionString, blobs })
    : createSqliteHubStorage(options.dbPath, blobs)
  try {
    await storage.ready
    const clock = new SystemClock()
    const realtime = new RealtimeEventHub({
      clock,
      // 重启占一个不投递的序号；旧游标不能将新进程的历史误当成连续事件。
      initialSeq: await storage.allocateRealtimeSeq(),
      allocateSeq: storage.allocateRealtimeSeq,
    })
    const hub = createHubContainer({
      ...options,
      repositories: storage,
      realtime,
      clock,
      artifactStorage: storage.artifactStorage,
    })
    const { app } = hub
    const shellOrigin = new URL(options.origin).origin
    const canConnect = async (request: Request): Promise<boolean> => {
      const origin = request.headers.get('Origin')
      if (origin && origin !== shellOrigin) return false
      const url = new URL(request.url)
      return (
        Boolean(await hub.authenticate(request)) ||
        hub.authorizeRealtime(request, {
          artifactId: url.searchParams.get('artifactId') ?? undefined,
          projectId: url.searchParams.get('projectId') ?? undefined,
        })
      )
    }

    const { injectWebSocket, wss } = attachNodeWebSocket(app, realtime, {
      authorizeUpgrade: canConnect,
      authorizeSubscription: hub.authorizeRealtime,
      authorizeEvent: hub.authorizeRealtimeEvent,
    })
    app.get('/assets/*', serveStatic({ root: options.webDir }))
    const shell = index.replace(
      '</head>',
      `<script>window.__AKASHA_CONFIG__=${JSON.stringify({
        sandboxOrigin: new URL(options.sandboxOrigin).origin,
        hub: true,
      })};</script></head>`,
    )
    app.get('/', (c) => c.html(shell, 200, { 'Cache-Control': 'no-store' }))
    app.get('/a/*', (c) => c.html(shell, 200, { 'Cache-Control': 'no-store' }))

    const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port })
    injectWebSocket(server)
    await once(server, 'listening')
    const sockets = new Set<Socket>()
    server.on('connection', (socket: Socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
    return {
      ...hub,
      server,
      async close() {
        // WS 断开会发布最后的在线状态；等断开和写入都结束后才能关库。
        const closed = Promise.all([once(server, 'close'), once(wss, 'close')])
        server.close()
        wss.close()
        for (const socket of sockets) socket.destroy()
        await closed
        await realtime.waitForPendingPublishes()
        await storage.close()
      },
    }
  } catch (error) {
    await storage.close()
    throw error
  }
}
