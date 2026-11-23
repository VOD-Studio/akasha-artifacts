import {
  PROTOCOL_VERSION,
  type RealtimeServerEvent,
  RealtimeServerEventSchema,
} from '@akasha/protocol'

/**
 * 唤醒原因。
 *
 * @remarks `feedback`：有新反馈；`round.submitted`：评审轮次已提交；
 * `resync`：游标失效，需要对账。
 */
export type WakeupReason = 'feedback' | 'round.submitted' | 'resync'

export interface WakeupBatch {
  projectId: string
  // 批次涉及的制品；只监听单个制品时就是它
  artifactIds: string[]
  // 本批包含的唤醒原因，已去重
  reasons: WakeupReason[]
  // 本批最后一条事件的序号，宿主重连时作为 lastSeq
  latestSeq: number
  // 触发本批的原始事件
  events: RealtimeServerEvent[]
}

export interface AsyncWakeupMonitorOptions {
  wsUrl: string
  projectId: string
  // 只监听该制品；省略则监听整个项目
  artifactId?: string
  // 突发事件的合并窗口（毫秒），缺省 250；0 表示收到即唤醒
  debounceMs?: number
  // 防抖窗口结束后交出合并批次
  onWakeup: (batch: WakeupBatch) => void
  WebSocketImpl?: typeof WebSocket
}

/**
 * 判定一条实时事件是否应触发后台异步唤醒。
 *
 * @returns 唤醒原因；草稿反馈、未提交的轮次与其他事件返回 `null`。
 *
 * @remarks `resync` 也算唤醒原因，用于在断线或 Daemon 重启后做一次对账，避免遗漏反馈。
 */
export function classifyWakeupEvent(event: RealtimeServerEvent): WakeupReason | null {
  if (event.type === 'feedback.created') {
    return event.feedback.draft ? null : 'feedback'
  }
  if (event.type === 'round.updated' && event.round.status === 'submitted') {
    return 'round.submitted'
  }
  if (event.type === 'resync') {
    return 'resync'
  }
  return null
}

/**
 * 后台异步唤醒监视器：监听服务端的 WebSocket 事件流，过滤草稿与无关制品的事件，
 * 并把防抖窗口内的突发通知合并成一次唤醒。
 *
 * @remarks 连接断开 1 秒后自动重连，重连时带上 `lastSeq` 续传。
 */
export class AsyncWakeupMonitor {
  private ws: WebSocket | null = null
  private lastSeq = 0
  private closed = false
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private bufferedEvents: RealtimeServerEvent[] = []
  private bufferedReasons = new Set<WakeupReason>()
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

  /** 处理一条实时事件；测试可以直接调用，不必经过 WebSocket。 */
  handleEvent(event: RealtimeServerEvent): void {
    // 收到 resync 说明游标失效或 Daemon 重启导致序列重置，必须同步采纳服务端当前 seq
    if (event.type === 'resync') {
      this.lastSeq = event.seq
    } else if (event.seq > this.lastSeq) {
      this.lastSeq = event.seq
    }

    if (
      this.artifactId &&
      'artifactId' in event &&
      event.artifactId &&
      event.artifactId !== this.artifactId
    ) {
      return
    }

    const reason = classifyWakeupEvent(event)
    if (!reason) return

    this.bufferedEvents.push(event)
    this.bufferedReasons.add(reason)
    if ('artifactId' in event && event.artifactId) {
      this.bufferedArtifacts.add(event.artifactId)
    } else if (this.artifactId) {
      this.bufferedArtifacts.add(this.artifactId)
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

  /** 立即交出缓冲中的事件并清空；没有缓冲时不触发回调。 */
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
      // RealtimeEventHub 对 artifactId 与 projectId 采用 OR 匹配；指定单 Artifact 监听时只订阅 artifactId，防止收到同项目其它 Artifact 的事件。
      socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'subscribe',
          ...(this.artifactId ? { artifactId: this.artifactId } : { projectId: this.projectId }),
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
