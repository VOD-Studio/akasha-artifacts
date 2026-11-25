import {
  PROTOCOL_VERSION,
  type RealtimeClientMessage,
  type RealtimeServerEvent,
  RealtimeServerEventSchema,
} from '@akasha/protocol'

export type WsConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

/** 订阅范围：制品、项目，或两者。 */
export interface WsSubscriptionTarget {
  artifactId?: string
  projectId?: string
}

export interface AkashaWsClientOptions {
  url: string
  // 订阅范围；缺省为空，即订阅全部
  target?: WsSubscriptionTarget
  onEvent: (event: RealtimeServerEvent) => void
  onStatusChange?: (status: WsConnectionStatus) => void
  /** 仅在服务端拒绝订阅时通知，不将主动卸载或普通断线误作撤权。 */
  onAccessDenied?: () => void
  WebSocketImpl?: typeof WebSocket
  // 首次重连的等待（毫秒），缺省 500
  baseRetryMs?: number
  // 重连等待的上限（毫秒），缺省 8000
  maxRetryMs?: number
}

/**
 * 实时 WebSocket 客户端。
 *
 * @remarks 维护单调递增的 `lastSeq`，重连时带上它让服务端补发；重连按指数退避。
 * 连接建立后每 25 秒发一次 ping。收到 4403 关闭码（没有订阅权限）后不再重连。
 */
export class AkashaWsClient {
  private ws: WebSocket | null = null
  private lastSeq = 0
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private pingTimer: ReturnType<typeof setInterval> | undefined
  private closedByUser = false
  private target: WsSubscriptionTarget

  private readonly url: string
  private readonly onEvent: (event: RealtimeServerEvent) => void
  private readonly onStatusChange?: (status: WsConnectionStatus) => void
  private readonly onAccessDenied?: () => void
  private readonly WebSocketImpl: typeof WebSocket
  private readonly baseRetryMs: number
  private readonly maxRetryMs: number

  constructor(options: AkashaWsClientOptions) {
    this.url = options.url
    this.target = options.target ?? {}
    this.onEvent = options.onEvent
    this.onStatusChange = options.onStatusChange
    this.onAccessDenied = options.onAccessDenied
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket
    this.baseRetryMs = options.baseRetryMs ?? 500
    this.maxRetryMs = options.maxRetryMs ?? 8000
  }

  /** 已收到的最大事件序号。 */
  getLastSeq(): number {
    return this.lastSeq
  }

  connect(): void {
    this.closedByUser = false
    if (!this.ws && this.retryTimer === undefined) this.openSocket()
  }

  /** 更新订阅范围；连接打开时先退订旧范围，再订阅新范围。 */
  updateTarget(next: WsSubscriptionTarget): void {
    const prev = this.target
    if (prev.artifactId === next.artifactId && prev.projectId === next.projectId) return
    if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN) {
      this.sendMessage({
        v: PROTOCOL_VERSION,
        type: 'unsubscribe',
        ...(prev.artifactId ? { artifactId: prev.artifactId } : {}),
        ...(prev.projectId ? { projectId: prev.projectId } : {}),
      })
    }
    this.target = next
    if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN) {
      this.sendSubscribe()
    }
  }

  /** 关闭连接并停止重连。 */
  close(): void {
    this.closedByUser = true
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.pingTimer !== undefined) {
      clearInterval(this.pingTimer)
      this.pingTimer = undefined
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
    this.onStatusChange?.('closed')
  }

  private openSocket(): void {
    this.onStatusChange?.(this.retryCount === 0 ? 'connecting' : 'reconnecting')
    const socket = new this.WebSocketImpl(this.url)
    this.ws = socket

    socket.onopen = () => {
      this.retryCount = 0
      this.onStatusChange?.('open')
      this.sendSubscribe()
      if (this.pingTimer !== undefined) clearInterval(this.pingTimer)
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
          this.sendMessage({ v: PROTOCOL_VERSION, type: 'ping' })
        }
      }, 25_000)
    }

    socket.onmessage = (evt) => {
      let raw: unknown
      try {
        raw = JSON.parse(String(evt.data))
      } catch {
        return
      }
      const parsed = RealtimeServerEventSchema.safeParse(raw)
      if (!parsed.success) return
      if (parsed.data.type === 'resync' || parsed.data.seq > this.lastSeq) {
        this.lastSeq = parsed.data.seq
      }
      this.onEvent(parsed.data)
    }

    socket.onerror = () => {
      // 由 onclose 统一触发退避重连
    }

    socket.onclose = (event) => {
      if (this.pingTimer !== undefined) {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
      }
      this.ws = null
      if (this.closedByUser) return
      if (event?.code === 4403) {
        this.onStatusChange?.('closed')
        this.onAccessDenied?.()
        return
      }
      this.scheduleReconnect()
    }
  }

  private sendSubscribe(): void {
    const msg: RealtimeClientMessage = {
      v: PROTOCOL_VERSION,
      type: 'subscribe',
      ...(this.target.artifactId ? { artifactId: this.target.artifactId } : {}),
      ...(this.target.projectId ? { projectId: this.target.projectId } : {}),
      ...(this.lastSeq > 0 ? { lastSeq: this.lastSeq } : {}),
    }
    this.sendMessage(msg)
  }

  private sendMessage(msg: RealtimeClientMessage): void {
    if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(this.maxRetryMs, this.baseRetryMs * 2 ** this.retryCount)
    this.retryCount += 1
    this.onStatusChange?.('reconnecting')
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (!this.closedByUser) {
        this.openSocket()
      }
    }, delay)
  }
}
