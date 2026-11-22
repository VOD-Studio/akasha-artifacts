import {
  PROTOCOL_VERSION,
  type RealtimeClientMessage,
  type RealtimeServerEvent,
  RealtimeServerEventSchema,
} from '@akasha/protocol'

export type WsConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WsSubscriptionTarget {
  artifactId?: string
  projectId?: string
}

export interface AkashaWsClientOptions {
  url: string
  target?: WsSubscriptionTarget
  onEvent: (event: RealtimeServerEvent) => void
  onStatusChange?: (status: WsConnectionStatus) => void
  WebSocketImpl?: typeof WebSocket
  baseRetryMs?: number
  maxRetryMs?: number
}

// 实时 WebSocket 客户端：维护单调 lastSeq，断线指数退避重连并自动携带 lastSeq 补齐漏收事件。
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
  private readonly WebSocketImpl: typeof WebSocket
  private readonly baseRetryMs: number
  private readonly maxRetryMs: number

  constructor(options: AkashaWsClientOptions) {
    this.url = options.url
    this.target = options.target ?? {}
    this.onEvent = options.onEvent
    this.onStatusChange = options.onStatusChange
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket
    this.baseRetryMs = options.baseRetryMs ?? 500
    this.maxRetryMs = options.maxRetryMs ?? 8000
  }

  getLastSeq(): number {
    return this.lastSeq
  }

  connect(): void {
    this.closedByUser = false
    this.openSocket()
  }

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
      if (parsed.data.seq > this.lastSeq) {
        this.lastSeq = parsed.data.seq
      }
      this.onEvent(parsed.data)
    }

    socket.onerror = () => {
      // 由 onclose 统一触发退避重连
    }

    socket.onclose = () => {
      if (this.pingTimer !== undefined) {
        clearInterval(this.pingTimer)
        this.pingTimer = undefined
      }
      this.ws = null
      if (this.closedByUser) return
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
