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
  maxHistory?: number
  // 持久化后端重启后传入上次 seq + 1，使所有携带旧游标的重连客户端必定收到 resync
  initialSeq?: number
  onSeqAdvance?: (seq: number) => void
  resolveArtifactProject?: (artifactId: PublicId) => string | undefined
}

// 统一实时事件总线：支持按项目/Artifact 订阅、基于单调 seq 的断线补发、重启/超窗触发 resync，
// 以及页面在线人数（presence）与 Agent 活跃状态追踪。
export class RealtimeEventHub implements RealtimePublisher, RealtimeSubscriber {
  private seq: number
  private readonly minAvailableSeq: number
  private nextSubId = 0
  private readonly maxHistory: number
  private readonly history: StoredEventRecord[] = []
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

  async publish(payload: RealtimeEventPayload, meta?: RealtimePublishMeta): Promise<void> {
    this.seq += 1
    this.options.onSeqAdvance?.(this.seq)

    const event = {
      ...payload,
      v: PROTOCOL_VERSION,
      seq: this.seq,
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
    const projectId =
      this.artifactProjects.get(artifactId) ?? this.options.resolveArtifactProject?.(artifactId)
    await this.publish(
      {
        type: 'presence.changed',
        artifactId,
        viewers,
        agentOnline,
      },
      projectId ? { projectId } : undefined,
    )
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
