import type { AgentActivityState, PublicId, RealtimeServerEvent } from '@akasha/protocol'
import { PROTOCOL_VERSION } from '@akasha/protocol'
import type {
  Clock,
  RealtimeEventPayload,
  RealtimePublisher,
  RealtimePublishMeta,
  RealtimeSubscriber,
  RealtimeSubscriptionOptions,
} from '../../domain/ports.js'

interface StoredEventRecord {
  event: RealtimeServerEvent
  projectId?: string
}

interface ActiveSubscriber {
  id: number
  artifactId?: PublicId
  projectId?: string
  onEvent: (event: RealtimeServerEvent) => void
}

export interface EventHubOptions {
  clock: Clock
  // 内存中保留的事件条数，缺省 500；超出后旧游标只能收到 resync
  maxHistory?: number
  // 持久化后端重启后传入上次 seq + 1，使所有携带旧游标的重连客户端必定收到 resync
  initialSeq?: number
  // 序号每次前进时回调，供持久化后端落库
  onSeqAdvance?: (seq: number) => void
  // 改由数据库分配序号；设置后发布按队列串行，保证分配与投递同序
  allocateSeq?: () => Promise<number>
  // 发布时未带项目且总线未知该制品时，用来反查所属项目
  resolveArtifactProject?: (artifactId: PublicId) => string | undefined
}

/**
 * 统一实时事件总线：按项目或 Artifact 订阅，基于单调 `seq` 断线补发，
 * 并维护页面在线人数与 Agent 活跃状态。
 *
 * @remarks 事件已超出保留窗口或服务端重启后，携带旧游标的重连收到的是 `resync` 而不是补发。
 */
export class RealtimeEventHub implements RealtimePublisher, RealtimeSubscriber {
  private seq: number
  private readonly minAvailableSeq: number
  private nextSubId = 0
  private readonly maxHistory: number
  private readonly history: StoredEventRecord[] = []
  private publishQueue?: Promise<void>
  private readonly subscribers = new Map<number, ActiveSubscriber>()
  private readonly artifactProjects = new Map<PublicId, string>()
  private readonly agentActivities = new Map<
    string,
    { state: AgentActivityState; summary?: string; updatedAt: string }
  >()

  constructor(private readonly options: EventHubOptions) {
    this.maxHistory = options.maxHistory ?? 500
    this.seq = options.initialSeq ?? 0
    this.minAvailableSeq = this.seq + 1
  }

  /** 当前已分配的最大事件序号。 */
  getLatestSeq(): number {
    return this.seq
  }

  getActiveConnections(): number {
    return this.subscribers.size
  }

  /** 订阅了该制品的连接数。 */
  getViewerCount(artifactId: PublicId): number {
    let count = 0
    for (const sub of this.subscribers.values()) {
      if (sub.artifactId === artifactId) count++
    }
    return count
  }

  /** 某项目最近一次上报的 Agent 活跃状态；从未上报时为 `offline`。 */
  getAgentActivity(projectId: string): {
    state: AgentActivityState
    summary?: string
    updatedAt: string
  } {
    return (
      this.agentActivities.get(projectId) ?? {
        state: 'offline',
        updatedAt: this.options.clock.now(),
      }
    )
  }

  /** 以 `agent.activity` 事件的形式广播 Agent 活跃状态。 */
  async reportAgentActivity(input: {
    projectId: string
    artifactId?: PublicId
    state: AgentActivityState
    summary?: string
  }): Promise<void> {
    await this.publish(
      {
        type: 'agent.activity',
        projectId: input.projectId,
        ...(input.artifactId ? { artifactId: input.artifactId } : {}),
        state: input.state,
        ...(input.summary ? { summary: input.summary } : {}),
      },
      { projectId: input.projectId },
    )
  }

  /** 发布一条事件，并同步投递给所有匹配的订阅者。 */
  async publish(payload: RealtimeEventPayload, meta?: RealtimePublishMeta): Promise<void> {
    const allocateSeq = this.options.allocateSeq
    if (!allocateSeq) {
      this.deliver(this.seq + 1, payload, meta)
      return
    }
    // 数据库分配与投递必须同序，且只有已持久化的序号才能向客户端可见。
    const send = async () => this.deliver(await allocateSeq(), payload, meta)
    const publish = this.publishQueue ? this.publishQueue.then(send) : send()
    this.publishQueue = publish.catch(() => {})
    await publish
  }

  /** 等待由数据库分配序号的发布全部完成；关闭存储之前调用。 */
  async waitForPendingPublishes(): Promise<void> {
    await this.publishQueue
  }

  private deliver(seq: number, payload: RealtimeEventPayload, meta?: RealtimePublishMeta): void {
    this.seq = seq
    this.options.onSeqAdvance?.(seq)

    const event = {
      ...payload,
      v: PROTOCOL_VERSION,
      seq,
      timestamp: this.options.clock.now(),
    } as RealtimeServerEvent

    if (event.type === 'agent.activity') {
      this.agentActivities.set(event.projectId, {
        state: event.state,
        summary: event.summary,
        updatedAt: event.timestamp,
      })
    }

    const artifactId = 'artifactId' in event ? event.artifactId : undefined
    let projectId = meta?.projectId ?? ('projectId' in event ? event.projectId : undefined)
    if (artifactId && projectId) {
      this.artifactProjects.set(artifactId, projectId)
    } else if (artifactId && !projectId) {
      projectId =
        this.artifactProjects.get(artifactId) ?? this.options.resolveArtifactProject?.(artifactId)
      if (projectId) {
        this.artifactProjects.set(artifactId, projectId)
      }
    }

    const record: StoredEventRecord = { event, projectId }
    this.history.push(record)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }

    for (const sub of this.subscribers.values()) {
      if (matchesSubscriber(sub, record)) {
        try {
          sub.onEvent(event)
        } catch {
          // 单个消费方异常不影响其余订阅者投递
        }
      }
    }
  }

  /**
   * 订阅一个范围，返回取消订阅的函数。
   *
   * @remarks 给出 `lastSeq` 时先补发其后的事件；游标超前于服务端或已超出保留窗口时改发 `resync`。
   * 订阅或取消订阅制品后会广播一次 `presence.changed`。
   */
  subscribe(opts: RealtimeSubscriptionOptions): () => void {
    const id = ++this.nextSubId
    const sub: ActiveSubscriber = {
      id,
      artifactId: opts.artifactId,
      projectId: opts.projectId,
      onEvent: opts.onEvent,
    }

    // 断线重连补齐：
    // 1. lastSeq > this.seq：服务端重启且序号归零，客户端超前，必须 resync；
    // 2. lastSeq + 1 < earliestAvailable：落出内存窗口或跨越持久化重启代差，必须 resync；
    // 3. 否则按序补发所有 seq > lastSeq 的匹配事件。
    if (opts.lastSeq !== undefined) {
      const earliest = this.history[0]?.event.seq ?? this.minAvailableSeq
      if (opts.lastSeq > this.seq) {
        opts.onEvent({
          v: PROTOCOL_VERSION,
          seq: Math.max(this.seq, 1),
          timestamp: this.options.clock.now(),
          type: 'resync',
          ...(opts.artifactId ? { artifactId: opts.artifactId } : {}),
          reason: `客户端游标 ${opts.lastSeq} 超前于当前服务端序号 ${this.seq}（服务端可能已重启）`,
        })
      } else if (opts.lastSeq < this.seq && opts.lastSeq + 1 < earliest) {
        opts.onEvent({
          v: PROTOCOL_VERSION,
          seq: this.seq,
          timestamp: this.options.clock.now(),
          type: 'resync',
          ...(opts.artifactId ? { artifactId: opts.artifactId } : {}),
          reason: `请求续传序号 ${opts.lastSeq} 已超出服务端保留窗口（最早可补发 ${earliest}）`,
        })
      } else if (opts.lastSeq < this.seq) {
        for (const record of this.history) {
          if (record.event.seq > opts.lastSeq && matchesSubscriber(sub, record)) {
            opts.onEvent(record.event)
          }
        }
      }
    }

    this.subscribers.set(id, sub)

    if (opts.artifactId) {
      this.emitPresence(opts.artifactId)
    }

    return () => {
      const existed = this.subscribers.delete(id)
      if (existed && opts.artifactId) {
        this.emitPresence(opts.artifactId)
      }
    }
  }

  private emitPresence(artifactId: PublicId): void {
    const viewers = this.getViewerCount(artifactId)
    const agentOnline = Array.from(this.agentActivities.values()).some((a) => a.state !== 'offline')
    const projectId =
      this.artifactProjects.get(artifactId) ?? this.options.resolveArtifactProject?.(artifactId)
    void this.publish(
      {
        type: 'presence.changed',
        artifactId,
        viewers,
        agentOnline,
      },
      projectId ? { projectId } : undefined,
    ).catch((error) => console.error('无法发布在线状态', error))
  }
}

function matchesSubscriber(sub: ActiveSubscriber, record: StoredEventRecord): boolean {
  if (!sub.artifactId && !sub.projectId) return true
  const { event, projectId } = record
  if (sub.artifactId && 'artifactId' in event && event.artifactId === sub.artifactId) {
    return true
  }
  if (sub.projectId && projectId === sub.projectId) {
    return true
  }
  return false
}
