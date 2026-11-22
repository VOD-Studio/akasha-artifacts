import {
  PROTOCOL_VERSION,
  type RealtimeServerEvent,
  RealtimeServerEventSchema,
} from '@akasha/protocol'

export interface WakeupBatch {
  projectId: string
  artifactIds: string[]
  reasons: Array<'feedback' | 'round.submitted'>
  latestSeq: number
  events: RealtimeServerEvent[]
}

export interface AsyncWakeupMonitorOptions {
  wsUrl: string
  projectId: string
  artifactId?: string
  debounceMs?: number
  onWakeup: (batch: WakeupBatch) => void
  WebSocketImpl?: typeof WebSocket
}

// 判定某条实时事件是否应当触发后台异步唤醒：
// 未提交评审轮次中的草稿评论（draft === true）与非 submitted 轮次一律不唤醒，严防中途打断用户。
export function classifyWakeupEvent(
  event: RealtimeServerEvent,
): 'feedback' | 'round.submitted' | null {
  if (event.type === 'feedback.created') {
    return event.feedback.draft ? null : 'feedback'
  }
  if (event.type === 'round.updated' && event.round.status === 'submitted') {
    return 'round.submitted'
  }
  return null
}

// 后台异步唤醒监视器：监听 Daemon WS 事件流，过滤草稿事件，并将突发通知按防抖窗口合并为单次唤醒。
export class AsyncWakeupMonitor {
  private ws: WebSocket | null = null
  private lastSeq = 0
  private closed = false
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private bufferedEvents: RealtimeServerEvent[] = []
  private bufferedReasons = new Set<'feedback' | 'round.submitted'>()
  private bufferedArtifacts = new Set<string>()

  private readonly wsUrl: string
  private readonly projectId: string
  private readonly artifactId?: string
  private readonly debounceMs: number
  private readonly onWakeup: (batch: WakeupBatch) => void
  private readonly WebSocketImpl: typeof WebSocket

  constructor(options: AsyncWakeupMonitorOptions) {
    this.wsUrl = options.wsUrl
    this.projectId = options.projectId
    this.artifactId = options.artifactId
    this.debounceMs = options.debounceMs ?? 250
    this.onWakeup = options.onWakeup
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket
  }

  start(): void {
    this.closed = false
    this.connect()
  }

  stop(): void {
    this.closed = true
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  // 直接喂入事件（便于单元测试验证防抖合并与草稿过滤逻辑）
  handleEvent(event: RealtimeServerEvent): void {
    if (event.seq > this.lastSeq) {
      this.lastSeq = event.seq
    }
    const reason = classifyWakeupEvent(event)
    if (!reason) return

    this.bufferedEvents.push(event)
    this.bufferedReasons.add(reason)
    if ('artifactId' in event && event.artifactId) {
      this.bufferedArtifacts.add(event.artifactId)
    }

    if (this.debounceMs <= 0) {
      this.flush()
      return
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.flush()
    }, this.debounceMs)
  }

  flush(): void {
    if (this.bufferedEvents.length === 0) return
    const batch: WakeupBatch = {
      projectId: this.projectId,
      artifactIds: Array.from(this.bufferedArtifacts),
      reasons: Array.from(this.bufferedReasons),
      latestSeq: this.lastSeq,
      events: this.bufferedEvents,
    }
    this.bufferedEvents = []
    this.bufferedReasons.clear()
    this.bufferedArtifacts.clear()
    this.onWakeup(batch)
  }

  private connect(): void {
    const socket = new this.WebSocketImpl(this.wsUrl)
    this.ws = socket

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'subscribe',
          projectId: this.projectId,
          ...(this.artifactId ? { artifactId: this.artifactId } : {}),
          ...(this.lastSeq > 0 ? { lastSeq: this.lastSeq } : {}),
        }),
      )
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
      this.handleEvent(parsed.data)
    }

    socket.onerror = () => {
      // 由 onclose 触发重连
    }

    socket.onclose = () => {
      this.ws = null
      if (this.closed) return
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined
        if (!this.closed) this.connect()
      }, 1000)
    }
  }
}
