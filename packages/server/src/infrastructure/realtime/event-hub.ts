import type { AgentActivityState, PublicId, RealtimeServerEvent } from '@akasha/protocol'
import { PROTOCOL_VERSION } from '@akasha/protocol'
import type {
  Clock,
  RealtimeEventPayload,
  RealtimePublisher,
  RealtimeSubscriber,
  RealtimeSubscriptionOptions,
} from '../../domain/ports.js'

interface ActiveSubscriber {
  id: number
  artifactId?: PublicId
  projectId?: string
  onEvent: (event: RealtimeServerEvent) => void
}

export interface EventHubOptions {
  clock: Clock
  maxHistory?: number
}

// 统一实时事件总线：支持按项目/Artifact 订阅、基于单调 seq 的断线补发、超出窗口触发 resync，
// 以及页面在线人数（presence）与 Agent 活跃状态追踪。
export class RealtimeEventHub implements RealtimePublisher, RealtimeSubscriber {
  private seq = 0
  private nextSubId = 0
  private readonly maxHistory: number
  private readonly history: RealtimeServerEvent[] = []
  private readonly subscribers = new Map<number, ActiveSubscriber>()
  private readonly agentActivities = new Map<
    string,
    { state: AgentActivityState; summary?: string; updatedAt: string }
  >()

  constructor(private readonly options: EventHubOptions) {
    this.maxHistory = options.maxHistory ?? 500
  }

  getLatestSeq(): number {
    return this.seq
  }

  getActiveConnections(): number {
    return this.subscribers.size
  }

  getViewerCount(artifactId: PublicId): number {
    let count = 0
    for (const sub of this.subscribers.values()) {
      if (sub.artifactId === artifactId) count++
    }
    return count
  }

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

  async reportAgentActivity(input: {
    projectId: string
    artifactId?: PublicId
    state: AgentActivityState
    summary?: string
  }): Promise<void> {
    this.agentActivities.set(input.projectId, {
      state: input.state,
      summary: input.summary,
      updatedAt: this.options.clock.now(),
    })
    await this.publish({
      type: 'agent.activity',
      projectId: input.projectId,
      ...(input.artifactId ? { artifactId: input.artifactId } : {}),
      state: input.state,
      ...(input.summary ? { summary: input.summary } : {}),
    })
  }

  async publish(payload: RealtimeEventPayload): Promise<void> {
    this.seq += 1
    const event = {
      ...payload,
      v: PROTOCOL_VERSION,
      seq: this.seq,
      timestamp: this.options.clock.now(),
    } as RealtimeServerEvent

    this.history.push(event)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }

    for (const sub of this.subscribers.values()) {
      if (matchesSubscriber(sub, event)) {
        try {
          sub.onEvent(event)
        } catch {
          // 单个消费方异常不影响其余订阅者投递
        }
      }
    }
  }

  subscribe(opts: RealtimeSubscriptionOptions): () => void {
    const id = ++this.nextSubId
    const sub: ActiveSubscriber = {
      id,
      artifactId: opts.artifactId,
      projectId: opts.projectId,
      onEvent: opts.onEvent,
    }

    // 断线重连补齐：lastSeq 落在保留窗口内按序补发，超出窗口则发送 resync 提示全量拉取
    if (opts.lastSeq !== undefined && opts.lastSeq < this.seq) {
      const oldest = this.history[0]?.seq
      if (oldest !== undefined && opts.lastSeq + 1 < oldest) {
        opts.onEvent({
          v: PROTOCOL_VERSION,
          seq: this.seq,
          timestamp: this.options.clock.now(),
          type: 'resync',
          ...(opts.artifactId ? { artifactId: opts.artifactId } : {}),
          reason: `请求续传序号 ${opts.lastSeq} 已超出服务端保留窗口（最早 ${oldest}）`,
        })
      } else {
        for (const ev of this.history) {
          if (ev.seq > opts.lastSeq && matchesSubscriber(sub, ev)) {
            opts.onEvent(ev)
          }
        }
      }
    }

    this.subscribers.set(id, sub)

    if (opts.artifactId) {
      void this.emitPresence(opts.artifactId)
    }

    return () => {
      const existed = this.subscribers.delete(id)
      if (existed && opts.artifactId) {
        void this.emitPresence(opts.artifactId)
      }
    }
  }

  private async emitPresence(artifactId: PublicId): Promise<void> {
    const viewers = this.getViewerCount(artifactId)
    const agentOnline = Array.from(this.agentActivities.values()).some((a) => a.state !== 'offline')
    await this.publish({
      type: 'presence.changed',
      artifactId,
      viewers,
      agentOnline,
    })
  }
}

function matchesSubscriber(sub: ActiveSubscriber, event: RealtimeServerEvent): boolean {
  if (!sub.artifactId && !sub.projectId) return true
  if (sub.artifactId && 'artifactId' in event && event.artifactId === sub.artifactId) {
    return true
  }
  if (sub.projectId && 'projectId' in event && event.projectId === sub.projectId) {
    return true
  }
  return false
}
