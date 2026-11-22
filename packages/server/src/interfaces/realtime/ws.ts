import { RealtimeClientMessageSchema } from '@akasha/protocol'
import { createNodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import type { RealtimeSubscriber } from '../../domain/ports.js'

// 在 Node Hono 应用上挂载 /api/v1/ws 实时通道，并校验每条客户端订阅消息。
export function attachNodeWebSocket(app: Hono, realtime: RealtimeSubscriber) {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

  app.get(
    '/api/v1/ws',
    upgradeWebSocket(() => {
      const unsubscribers = new Map<string, () => void>()

      const subKey = (artifactId?: string, projectId?: string) =>
        `${artifactId ?? '*'}::${projectId ?? '*'}`

      return {
        onMessage(evt, ws) {
          let parsedJson: unknown
          try {
            parsedJson = JSON.parse(String(evt.data))
          } catch {
            return
          }
          const result = RealtimeClientMessageSchema.safeParse(parsedJson)
          if (!result.success) return
          const msg = result.data

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ v: msg.v, type: 'pong' }))
            return
          }

          const key = subKey(msg.artifactId, msg.projectId)
          if (msg.type === 'unsubscribe') {
            const unsub = unsubscribers.get(key)
            if (unsub) {
              unsub()
              unsubscribers.delete(key)
            }
            return
          }

          if (msg.type === 'subscribe') {
            const prev = unsubscribers.get(key)
            if (prev) prev()
            const unsub = realtime.subscribe({
              artifactId: msg.artifactId,
              projectId: msg.projectId,
              lastSeq: msg.lastSeq,
              onEvent: (event) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(event))
                }
              },
            })
            unsubscribers.set(key, unsub)
          }
        },
        onClose() {
          for (const unsub of unsubscribers.values()) {
            unsub()
          }
          unsubscribers.clear()
        },
      }
    }),
  )

  return { injectWebSocket }
}
