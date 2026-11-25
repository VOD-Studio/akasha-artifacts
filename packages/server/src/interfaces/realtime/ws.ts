import { RealtimeClientMessageSchema, type RealtimeServerEvent } from '@akasha/protocol'
import { createNodeWebSocket, type NodeWebSocket } from '@hono/node-ws'
import type { Hono } from 'hono'
import type { RealtimeSubscriber } from '../../domain/ports.js'
import type { HubRealtimeScope } from '../http/hub-access.js'

// 三道授权钩子：本机校验制品可见性，Hub 进一步校验连接身份和分享范围。
interface NodeWebSocketAuthorization {
  // 是否允许把请求升级为 WebSocket
  authorizeUpgrade?: (request: Request) => Promise<boolean>
  // 是否允许订阅某个范围
  authorizeSubscription?: (request: Request, scope: HubRealtimeScope) => Promise<boolean>
  // 每条事件下发前再判断一次
  authorizeEvent?: (
    request: Request,
    scope: HubRealtimeScope,
    event: RealtimeServerEvent,
  ) => Promise<boolean>
}

/**
 * 在 Node Hono 应用上挂载 `/api/v1/ws` 实时通道，并校验每条客户端订阅消息。
 *
 * @remarks 解析失败的消息静默丢弃；同一连接重复订阅同一范围时先取消旧订阅。
 * 异步授权积压超过 1024 条事件时以 1013 关闭连接，让客户端重连。
 */
export function attachNodeWebSocket(
  app: Hono,
  realtime: RealtimeSubscriber,
  authorization?: NodeWebSocketAuthorization,
): Pick<NodeWebSocket, 'injectWebSocket' | 'wss'> {
  const { injectWebSocket, upgradeWebSocket, wss } = createNodeWebSocket({ app })

  app.get(
    '/api/v1/ws',
    async (c, next) => {
      if (authorization?.authorizeUpgrade && !(await authorization.authorizeUpgrade(c.req.raw))) {
        return c.json({ error: { code: 'FORBIDDEN', message: '没有访问实时通道的权限' } }, 403)
      }
      await next()
    },
    upgradeWebSocket((c) => {
      const request = c.req.raw
      const subscriptions = new Map<string, { unsubscribe?: () => void }>()

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

          const scope = { artifactId: msg.artifactId, projectId: msg.projectId }
          const key = JSON.stringify([msg.artifactId, msg.projectId])
          subscriptions.get(key)?.unsubscribe?.()
          if (msg.type === 'unsubscribe') {
            subscriptions.delete(key)
            return
          }
          const { lastSeq } = msg

          const subscription: { unsubscribe?: () => void } = {}
          subscriptions.set(key, subscription)
          const subscribe = () => {
            if (subscriptions.get(key) !== subscription || ws.readyState !== 1) return
            let queue = Promise.resolve()
            let pendingEvents = 0
            subscription.unsubscribe = realtime.subscribe({
              ...scope,
              lastSeq,
              onEvent: (event) => {
                if (subscriptions.get(key) !== subscription || ws.readyState !== 1) return
                const authorize = authorization?.authorizeEvent
                if (!authorize) {
                  ws.send(JSON.stringify(event))
                  return
                }
                if (++pendingEvents > 1024) {
                  ws.close(1013, '实时事件积压，请重连')
                  return
                }
                // 回放与直播共用同一个授权队列，不能因异步查权限而改变事件顺序。
                queue = queue
                  .then(async () => {
                    if (subscriptions.get(key) !== subscription || ws.readyState !== 1) return
                    const allowed = await authorize(request, scope, event)
                    if (subscriptions.get(key) !== subscription || ws.readyState !== 1) return
                    if (allowed) {
                      ws.send(JSON.stringify(event))
                    } else if (
                      scope.artifactId &&
                      event.type === 'artifact.metadata' &&
                      event.artifactId === scope.artifactId
                    ) {
                      // 仅已获准的单制品订阅能到达这里。撤权只发送关闭码，工作台随后丢弃旧缓存。
                      ws.close(4403, '制品访问权限已变更')
                    }
                  })
                  .catch(() => {
                    if (ws.readyState === 1) ws.close(1011, '无法检查实时事件权限')
                  })
                  .finally(() => {
                    pendingEvents--
                  })
              },
            })
          }

          const authorize = authorization?.authorizeSubscription
          if (!authorize) {
            subscribe()
            return
          }
          void authorize(request, scope)
            .then((allowed) => {
              if (allowed) subscribe()
              else if (subscriptions.get(key) === subscription) {
                subscriptions.delete(key)
                ws.close(4403, '没有订阅此范围的权限')
              }
            })
            .catch(() => {
              if (ws.readyState === 1) ws.close(1011, '无法检查订阅权限')
            })
        },
        onClose() {
          for (const subscription of subscriptions.values()) {
            subscription.unsubscribe?.()
          }
          subscriptions.clear()
        },
      }
    }),
  )

  return { injectWebSocket, wss }
}
