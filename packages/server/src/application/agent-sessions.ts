import {
  type AgentAvailability,
  type AgentConnection,
  type AgentConversation,
  type AgentConversationStatus,
  type AgentConversationTurn,
  type AgentPublication,
  type AnnotationAgentDelivery,
  type AnnotationThread,
  type ArtboardTweakApplication,
  type ArtboardTweakApplicationResult,
  type Artifact,
  type ArtifactHandoffReference,
  type ArtifactPublishInput,
  type ArtifactUpdateInput,
  applyArtboardTweakApplication,
  type Feedback,
  type PublicId,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import type { AgentRunner } from '../domain/agent-runner.js'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { DomainError, NotFoundError } from '../domain/errors.js'
import type {
  AnnotationAgentDispatcher,
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  IdGenerator,
  ProjectRepository,
  RealtimePublisher,
} from '../domain/ports.js'
import type { ArtifactService } from './artifact-service.js'

interface StoredSession {
  /** 只在本机 CLI 执行事件中取得，不接受 Web 或模型填入。 */
  threadId?: string
  /** 首发时的本机项目目录；重新登记相同项目 ID 不会转移授权线程。 */
  root?: string
  /** 写入制品前保留首发地址和轮次；只有实际存在的 v1 才确认发布。 */
  firstPublication?: { artifactId: string; turnId: string }
  /** 经过权限过滤后可向本机浏览器返回的信息。 */
  conversation: AgentConversation
}

interface RunningTurn {
  /** 尚未撤销的轮次凭证，不能用于普通 Daemon 接口。 */
  token: string
  /** 该会话唯一的活动轮次持有其可写记录。 */
  record: StoredSession
  /** 追加发布回执和真实回复的目标。 */
  turn: AgentConversationTurn
  /** 若由批注线程发起，记录原根批注 ID 以便回写线程状态、回复与发布版本。 */
  feedbackId?: string
  /** 在受理时仅计算、不写入；工具执行时仍须以原目标版本比较并提交。 */
  tweaks?: ArtboardTweakApplicationResult
  /** 本轮 CLI 已实际报告启动的是原发布线程。 */
  threadConfirmed: boolean
  /** 此轮启动时已登记且授权的执行目录。 */
  root: string
  /** 撤销授权时终止 CLI 并禁止剩余工具操作。 */
  controller: AbortController
  /** 工具与 CLI 使用同一截止时间，排队等待写锁也不能延长授权。 */
  signal: AbortSignal
  /** 串行提交轮次内工具请求，避免并行首发产生两个制品。 */
  tools: Promise<void>
}

interface QueuedAnnotation {
  artifactId: PublicId
  feedbackId: string
  sessionId: string
}

interface AgentSessionDeps {
  /** CLI 驱动由本机装配，Hub 没有此依赖。 */
  runner: AgentRunner
  /** 用内部命名空间持久化会话与制品索引，不进入制品运行存储。 */
  store: ArtifactStorageRepository
  /** 每次发送时重新验证项目仍按原目录登记。 */
  projects: ProjectRepository
  /** 校验固定源和当前归属。 */
  artifacts: ArtifactRepository
  ids: IdGenerator
  /** 真实发布与普通发布使用同一版本写入路径。 */
  service: ArtifactService
  /** 监听完成后取得本机回环地址，不使用请求 Host 拼接。 */
  baseUrl: () => string
  /** 回写批注线程的 Agent 执行状态、回复与版本时使用。 */
  feedbacks?: Pick<FeedbackRepository, 'annotations' | 'findById' | 'save'>
  /** 批注线程状态推进后实时通知订阅者刷新。 */
  realtime?: RealtimePublisher
  clock?: Clock
}

const sessionKey = (id: string) => `@agent/session/${id}`
const artifactKey = (id: string) => `@agent/artifact/${id}`
const unavailable = () =>
  new DomainError(
    'RESOURCE_CONFLICT',
    'Codex 未连接，请在本机运行 akasha agent connect --project <项目路径>',
  )
const forbidden = () => new DomainError('FORBIDDEN', '该工具请求超出了已授权制品或项目')
const invalidToken = () => new DomainError('UNAUTHORIZED', 'CLI 轮次凭证无效或已经结束')

function buildFeedbackTarget(artifact: Artifact, feedback: Feedback): ArtifactHandoffReference {
  if (!feedback.element) {
    return {
      artifactId: artifact.publicId,
      projectId: artifact.projectId,
      version: feedback.version,
    }
  }
  return {
    artifactId: artifact.publicId,
    projectId: artifact.projectId,
    version: feedback.version,
    boardId: feedback.element.boardId ?? STANDALONE_BOARD_ID,
    element: feedback.element,
  }
}

/** 本机维护者授权项目，只有实际 CLI 写入才建立可续接的发布会话。 */
export class AgentSessions implements AnnotationAgentDispatcher {
  private readonly connections = new Map<string, string>()
  private readonly running = new Map<string, RunningTurn>()
  private readonly tokens = new Map<string, RunningTurn>()
  private readonly annotationQueue = new Map<string, QueuedAnnotation[]>()
  private readonly queuedFeedbackIds = new Set<string>()
  private readonly drainingFeedbackIds = new Set<string>()
  private closed = false

  constructor(private readonly deps: AgentSessionDeps) {}

  private now() {
    return this.deps.clock?.now() ?? new Date().toISOString()
  }

  async connect(projectId: string) {
    const project = await this.deps.projects.findById(projectId)
    if (!project?.rootPath) throw new NotFoundError('请先登记本机项目')
    try {
      await this.deps.runner.check(project.rootPath)
    } catch {
      this.disconnect(projectId)
      throw new DomainError(
        'RESOURCE_CONFLICT',
        '未能连接 Codex：请安装 CLI 并运行 codex login，然后重新授权此项目',
      )
    }
    if (this.closed) throw unavailable()
    this.connections.set(projectId, project.rootPath)
  }

  disconnect(projectId: string) {
    this.connections.delete(projectId)
    const run = this.running.get(projectId)
    if (run) {
      this.tokens.delete(run.token)
      run.controller.abort(invalidToken())
    }
    const pending = this.annotationQueue.get(projectId)
    if (pending?.length) {
      this.annotationQueue.delete(projectId)
      for (const item of pending) {
        this.queuedFeedbackIds.delete(item.feedbackId)
        void this.failQueuedAnnotation(
          projectId,
          item,
          '本机 Codex 已断开，队列中的批注未自动重发。',
        )
      }
    }
  }

  async listConnections(): Promise<AgentConnection[]> {
    const items: AgentConnection[] = []
    for (const [projectId, root] of this.connections) {
      if ((await this.deps.projects.findById(projectId))?.rootPath !== root) continue
      items.push({
        projectId,
        harness: 'codex',
        availability: this.running.has(projectId) ? 'busy' : 'ready',
      })
    }
    return items
  }

  private async availability(projectId: string): Promise<AgentAvailability> {
    const root = this.connections.get(projectId)
    if (!root || (await this.deps.projects.findById(projectId))?.rootPath !== root) return 'offline'
    return this.running.has(projectId) ? 'busy' : 'ready'
  }

  async conversation(id: string): Promise<AgentConversation> {
    const record = await this.load(id)
    if (!record) throw new NotFoundError('未找到已授权的 Agent 会话')
    return record.conversation
  }

  async forArtifact(id: string): Promise<AgentConversationStatus> {
    const artifact = await this.requireArtifact(id)
    const index = await this.deps.store.read(artifactKey(id))
    const record = index ? await this.load(JSON.parse(index.json) as string) : undefined
    if (
      !record?.threadId ||
      !record.root ||
      record.conversation.artifactId !== id ||
      record.conversation.projectId !== artifact.projectId ||
      (await this.deps.projects.findById(artifact.projectId))?.rootPath !== record.root
    )
      return { availability: 'unbound' }
    return {
      availability: await this.availability(artifact.projectId),
      session: record.conversation,
    }
  }

  async dispatchFeedback(artifact: Artifact, feedback: Feedback): Promise<void> {
    if (!this.deps.feedbacks || this.closed) return
    const status = await this.forArtifact(artifact.publicId)
    // 未绑定受管 CLI 会话的制品保持原有 MCP 队列，不写入伪造的本地投递状态。
    if (!status.session) return
    const sessionId = status.session.id
    const now = this.now()
    let initial: AnnotationAgentDelivery
    if (status.availability === 'offline') {
      initial = {
        sessionId,
        state: 'failed',
        error: unavailable().message,
        publications: [],
        updatedAt: now,
      }
    } else if (status.availability === 'busy') {
      initial = {
        sessionId,
        state: 'queued',
        publications: [],
        updatedAt: now,
      }
    } else {
      initial = {
        sessionId,
        state: 'running',
        publications: [],
        updatedAt: now,
      }
    }
    // 原子抢占保证同一批注 ID 最多只投递一次，换页、重连或撤回重提均不重复触发。
    const claimed = await this.deps.feedbacks.annotations.claimAgentDelivery(feedback.id, initial)
    if (!claimed) return
    if (status.availability === 'offline') {
      await this.publishAnnotationChanged(artifact.publicId, artifact.projectId)
      return
    }
    if (status.availability === 'busy') {
      this.enqueueAnnotation(artifact.projectId, {
        artifactId: artifact.publicId,
        feedbackId: feedback.id,
        sessionId,
      })
      await this.publishAnnotationChanged(artifact.publicId, artifact.projectId)
      // 若前序轮次在 claimAgentDelivery 等待期间恰好结束并排空了旧队列，这里立即补排，避免滞留在 queued。
      if (!this.running.has(artifact.projectId)) {
        await this.drainAnnotationQueue(artifact.projectId)
      }
      return
    }
    await this.launchAnnotationTurn(artifact, feedback, sessionId)
  }

  async reconcileDeliveries(
    artifact: Artifact,
    threads: Record<string, AnnotationThread>,
  ): Promise<void> {
    if (!this.deps.feedbacks) return
    const activeFeedbackId = this.running.get(artifact.projectId)?.feedbackId
    for (const [feedbackId, thread] of Object.entries(threads)) {
      const delivery = thread.agent
      if (!delivery || (delivery.state !== 'queued' && delivery.state !== 'running')) continue
      if (
        feedbackId === activeFeedbackId ||
        this.queuedFeedbackIds.has(feedbackId) ||
        this.drainingFeedbackIds.has(feedbackId)
      )
        continue
      const failed: AnnotationAgentDelivery = {
        ...delivery,
        state: 'failed',
        error: 'Daemon 已中断原轮次，未自动重发。',
        updatedAt: this.now(),
      }
      // 条件更新：若期间轮次已完成并写入 replied/published，保留最新结果而非覆盖为失败。
      const settled = await this.deps.feedbacks.annotations.compareAndSetAgentDelivery(
        feedbackId,
        { state: delivery.state, updatedAt: delivery.updatedAt },
        failed,
      )
      if (settled) thread.agent = settled
    }
  }

  async startDesign(projectId: string, message: string) {
    return this.start(
      {
        conversation: { id: crypto.randomUUID(), projectId, harness: 'codex', turns: [] },
      },
      message,
    )
  }

  async continueArtifact(
    id: string,
    message: string,
    target?: ArtifactHandoffReference,
    application?: ArtboardTweakApplication,
  ) {
    const { session, availability } = await this.forArtifact(id)
    if (!session)
      throw new DomainError('RESOURCE_CONFLICT', '该制品没有由本机授权会话发布，不能附会到其他线程')
    if (availability === 'offline') throw unavailable()
    if (availability === 'busy')
      throw new DomainError('RESOURCE_CONFLICT', '该项目已有 CLI 轮次在进行')
    const record = await this.load(session.id)
    if (!record?.threadId) throw unavailable()
    if (application && (!target || target.boardId !== application.boardId)) throw forbidden()
    if (target) {
      if (target.artifactId !== id || target.projectId !== session.projectId) throw forbidden()
      const snapshot = await this.deps.artifacts.getVersion(id, target.version)
      if (!snapshot) throw new NotFoundError('指定选区版本不存在')
      if (application) {
        const artifact = await this.requireArtifact(id)
        if (artifact.projectId !== session.projectId || artifact.type !== 'artboard')
          throw forbidden()
        if (artifact.headVersion !== target.version)
          throw new DomainError('RESOURCE_CONFLICT', '画板版本已更新，请重新确认参数')
        let tweaks: ArtboardTweakApplicationResult
        try {
          tweaks = applyArtboardTweakApplication(snapshot.source, snapshot.version, application)
        } catch {
          throw new DomainError('BAD_REQUEST', '所选参数或画板不符合该版本的可应用范围')
        }
        return this.start(record, message, target, tweaks)
      }
    }
    return this.start(record, message, target)
  }

  authorizeTool(token: string) {
    if (!this.tokens.has(token)) throw invalidToken()
  }

  async readArtifact(token: string, id: string, projectId?: string, version?: number) {
    return this.withTool(token, async ({ record }) => {
      await this.requireBound(record, id, projectId)
      const result = await this.deps.service.getArtifact({
        id,
        projectId: record.conversation.projectId,
        version,
      })
      if (result.artifact.projectId !== record.conversation.projectId) throw forbidden()
      return result
    })
  }

  async publish(token: string, input: ArtifactPublishInput) {
    return this.withTool(token, async (run) => {
      const { conversation, threadId } = run.record
      if (
        (input.project !== undefined && input.project !== conversation.projectId) ||
        conversation.artifactId ||
        input.baseVersion !== undefined ||
        !threadId
      )
        throw forbidden()
      const first = await this.reserveFirstPublication(run)
      run.controller.signal.throwIfAborted()
      const result = await this.deps.service.publish({
        projectId: conversation.projectId,
        slug: input.slug,
        title: input.title,
        type: input.type,
        source: input.source,
        visibility: 'private',
        author: `agent:${conversation.id}`,
        preferredPublicId: first,
        createOnly: true,
      })
      conversation.artifactId = result.artifact.publicId
      // 这里不依赖再次写会话日志。已存在的 v1 加发布前预留记录足以恢复。
      run.turn.publications.push({ artifactId: result.artifact.publicId, version: 1 })
      return result
    })
  }

  async update(token: string, input: ArtifactUpdateInput) {
    return this.withTool(token, async (run) => {
      if (run.tweaks) throw forbidden()
      await this.requireBound(run.record, input.id, input.project)
      const result = await this.deps.service.update({
        id: input.id,
        projectId: run.record.conversation.projectId,
        baseVersion: input.baseVersion,
        title: input.title,
        edits: input.edits,
        author: `agent:${run.record.conversation.id}`,
      })
      await this.recordPublication(run, {
        artifactId: result.artifact.publicId,
        version: result.version.version,
      })
      return result
    })
  }

  /** 只提交该轮受理时算出的源稿；其他轮次、重复调用都没有写入权。 */
  async applyRequestedTweaks(token: string) {
    return this.withTool(token, async (run) => {
      const { target } = run.turn
      if (!run.tweaks || !target || !run.threadConfirmed) throw forbidden()
      if (run.turn.publications.length) throw new DomainError('RESOURCE_CONFLICT', '本轮参数已应用')
      await this.requireBound(run.record, target.artifactId, target.projectId)
      const { version } = await this.deps.service.update({
        id: target.artifactId,
        projectId: target.projectId,
        baseVersion: target.version,
        source: run.tweaks.source,
        author: `agent:${run.record.conversation.id}`,
        signal: run.signal,
      })
      const receipt = {
        artifactId: version.artifactId,
        version: version.version,
        changed: run.tweaks.changed,
      }
      await this.recordPublication(run, receipt)
      return receipt
    })
  }

  close() {
    this.closed = true
    for (const projectId of this.connections.keys()) this.disconnect(projectId)
    for (const [projectId, pending] of this.annotationQueue) {
      for (const item of pending) {
        this.queuedFeedbackIds.delete(item.feedbackId)
        void this.failQueuedAnnotation(projectId, item, 'Daemon 已中断原轮次，未自动重发。')
      }
    }
    this.annotationQueue.clear()
  }

  private enqueueAnnotation(projectId: string, item: QueuedAnnotation) {
    if (this.queuedFeedbackIds.has(item.feedbackId)) return
    this.queuedFeedbackIds.add(item.feedbackId)
    const queue = this.annotationQueue.get(projectId) ?? []
    queue.push(item)
    this.annotationQueue.set(projectId, queue)
  }

  private async failQueuedAnnotation(projectId: string, item: QueuedAnnotation, error: string) {
    if (!this.deps.feedbacks) return
    try {
      await this.deps.feedbacks.annotations.setAgentDelivery(item.feedbackId, {
        sessionId: item.sessionId,
        state: 'failed',
        error,
        publications: [],
        updatedAt: this.now(),
      })
      await this.publishAnnotationChanged(item.artifactId, projectId)
    } catch {
      // 停机或断开清理不产生未处理拒绝。
    }
  }

  private async queueBusyAnnotation(artifact: Artifact, feedbackId: string, sessionId: string) {
    if (!this.deps.feedbacks) return
    await this.deps.feedbacks.annotations.setAgentDelivery(feedbackId, {
      sessionId,
      state: 'queued',
      publications: [],
      updatedAt: this.now(),
    })
    this.enqueueAnnotation(artifact.projectId, {
      artifactId: artifact.publicId,
      feedbackId,
      sessionId,
    })
    await this.publishAnnotationChanged(artifact.publicId, artifact.projectId)
    if (!this.running.has(artifact.projectId)) {
      await this.drainAnnotationQueue(artifact.projectId)
    }
  }

  private async launchAnnotationTurn(artifact: Artifact, feedback: Feedback, sessionId: string) {
    if (!this.deps.feedbacks) return
    if (this.running.has(artifact.projectId)) {
      await this.queueBusyAnnotation(artifact, feedback.id, sessionId)
      return
    }
    try {
      const record = await this.load(sessionId)
      if (!record?.threadId) throw unavailable()
      // 并发提交在同一 await 窗口后可能已有其他轮次占槽，让出方转为排队而非报错失败。
      if (this.running.has(artifact.projectId)) {
        await this.queueBusyAnnotation(artifact, feedback.id, sessionId)
        return
      }
      const conversation = await this.start(
        record,
        feedback.body,
        buildFeedbackTarget(artifact, feedback),
        undefined,
        feedback.id,
      )
      const turn = conversation.turns.at(-1)
      await this.deps.feedbacks.annotations.setAgentDelivery(feedback.id, {
        sessionId,
        turnId: turn?.id,
        state: 'running',
        publications: [],
        updatedAt: this.now(),
      })
      await this.publishAnnotationChanged(artifact.publicId, artifact.projectId)
    } catch (error) {
      if (
        this.running.has(artifact.projectId) ||
        (error instanceof DomainError &&
          error.code === 'RESOURCE_CONFLICT' &&
          error.message === '该项目已有 CLI 轮次在进行')
      ) {
        await this.queueBusyAnnotation(artifact, feedback.id, sessionId)
        return
      }
      await this.deps.feedbacks.annotations.setAgentDelivery(feedback.id, {
        sessionId,
        state: 'failed',
        error:
          error instanceof DomainError ? error.message : '本机 Codex 未能受理该批注，未自动重发。',
        publications: [],
        updatedAt: this.now(),
      })
      await this.publishAnnotationChanged(artifact.publicId, artifact.projectId)
    }
  }

  private async drainAnnotationQueue(projectId: string) {
    while (!this.closed && !this.running.has(projectId) && this.deps.feedbacks) {
      const queue = this.annotationQueue.get(projectId)
      if (!queue?.length) return
      const next = queue.shift()
      if (!queue.length) this.annotationQueue.delete(projectId)
      if (!next) return
      this.queuedFeedbackIds.delete(next.feedbackId)
      this.drainingFeedbackIds.add(next.feedbackId)
      try {
        const [artifact, feedback] = await Promise.all([
          this.deps.artifacts.findByPublicId(next.artifactId),
          this.deps.feedbacks.findById(next.feedbackId),
        ])
        if (!artifact || !feedback) {
          await this.failQueuedAnnotation(projectId, next, '原制品或批注已不可访问，未继续执行。')
        } else {
          await this.launchAnnotationTurn(artifact, feedback, next.sessionId)
        }
      } finally {
        this.drainingFeedbackIds.delete(next.feedbackId)
      }
    }
  }

  private async publishAnnotationChanged(artifactId: PublicId, projectId: string) {
    await this.deps.realtime?.publish({ type: 'annotation.changed', artifactId }, { projectId })
  }

  private async syncRunningAnnotationDelivery(run: RunningTurn) {
    if (!run.feedbackId || !this.deps.feedbacks) return
    const { conversation } = run.record
    if (!conversation.artifactId) return
    await this.deps.feedbacks.annotations.setAgentDelivery(run.feedbackId, {
      sessionId: conversation.id,
      turnId: run.turn.id,
      state: 'running',
      publications: [...run.turn.publications],
      updatedAt: this.now(),
    })
    await this.publishAnnotationChanged(conversation.artifactId, conversation.projectId)
  }

  private async finalizeAnnotationDelivery(run: RunningTurn) {
    if (!run.feedbackId || !this.deps.feedbacks) return
    const { conversation } = run.record
    const artifactId = conversation.artifactId
    const now = this.now()
    const delivery: AnnotationAgentDelivery =
      run.turn.status === 'complete'
        ? {
            sessionId: conversation.id,
            turnId: run.turn.id,
            state: run.turn.publications.length > 0 ? 'published' : 'replied',
            reply: run.turn.reply,
            publications: [...run.turn.publications],
            updatedAt: now,
          }
        : {
            sessionId: conversation.id,
            turnId: run.turn.id,
            state: 'failed',
            error: run.turn.error,
            publications: [...run.turn.publications],
            updatedAt: now,
          }
    await this.deps.feedbacks.annotations.setAgentDelivery(run.feedbackId, delivery)
    if (run.turn.status === 'complete') {
      const fb = await this.deps.feedbacks.findById(run.feedbackId)
      if (fb && fb.status !== 'resolved') {
        const updated: Feedback = { ...fb, status: 'resolved', updatedAt: now }
        await this.deps.feedbacks.save(updated)
        await this.deps.realtime?.publish(
          { type: 'feedback.updated', artifactId: updated.artifactId, feedback: updated },
          { projectId: conversation.projectId },
        )
      }
    }
    if (artifactId) {
      await this.publishAnnotationChanged(artifactId, conversation.projectId)
    }
  }

  private async requireArtifact(id: string) {
    const artifact = await this.deps.artifacts.findByPublicId(id)
    if (!artifact) throw new NotFoundError('未找到活动制品')
    return artifact
  }

  private async requireBound(record: StoredSession, id: string, projectId?: string) {
    const session = record.conversation
    if (id !== session.artifactId || (projectId !== undefined && projectId !== session.projectId))
      throw forbidden()
    if ((await this.requireArtifact(id)).projectId !== session.projectId) throw forbidden()
  }

  private withTool<T>(token: string, action: (run: RunningTurn) => Promise<T>) {
    const run = this.tokens.get(token)
    if (!run) throw invalidToken()
    const result = run.tools.then(async () => {
      run.signal.throwIfAborted()
      if (
        this.connections.get(run.record.conversation.projectId) !== run.root ||
        (await this.deps.projects.findById(run.record.conversation.projectId))?.rootPath !==
          run.root
      )
        throw invalidToken()
      run.signal.throwIfAborted()
      return action(run)
    })
    run.tools = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async reserveFirstPublication({ record, turn }: RunningTurn) {
    const first = record.firstPublication ?? {
      artifactId: this.deps.ids.publicId(),
      turnId: turn.id,
    }
    record.firstPublication = first
    await this.save(record)
    const key = artifactKey(first.artifactId)
    const expected = JSON.stringify(record.conversation.id)
    const existing = await this.deps.store.read(key)
    if (
      existing
        ? existing.json !== expected
        : !(await this.deps.store.compareAndSet(key, 0, expected))
    )
      throw new DomainError('RESOURCE_CONFLICT', '首发地址已有其他绑定，未发布制品')
    return first.artifactId
  }

  private async load(id: string): Promise<StoredSession | undefined> {
    const snapshot = await this.deps.store.read(sessionKey(id))
    if (!snapshot) return
    const record = JSON.parse(snapshot.json) as StoredSession
    const first = record.firstPublication
    if (first && !record.conversation.artifactId) {
      const version = await this.deps.artifacts.getVersion(first.artifactId, 1)
      const origin = record.conversation.turns.find(({ id }) => id === first.turnId)
      if (version?.author === `agent:${id}` && origin) {
        record.conversation.artifactId = first.artifactId
        origin.publications.push({ artifactId: first.artifactId, version: 1 })
      }
    }
    const last = record.conversation.turns.at(-1)
    const active = this.running.get(record.conversation.projectId)
    if (last?.status === 'running' && active?.turn.id !== last.id) {
      last.status = 'failed'
      last.error = 'Daemon 已中断原轮次，未自动重发。'
    }
    return record
  }

  private async save(record: StoredSession, expectedTurn?: string | null) {
    if (this.closed) return
    const key = sessionKey(record.conversation.id)
    const previous = await this.deps.store.read(key)
    if (expectedTurn !== undefined) {
      const lastId = previous
        ? (JSON.parse(previous.json) as StoredSession).conversation.turns.at(-1)?.id
        : undefined
      if ((lastId ?? null) !== expectedTurn)
        throw new DomainError('RESOURCE_CONFLICT', '会话已收到新一轮消息，请刷新后重试')
    }
    if (
      !(await this.deps.store.compareAndSet(key, previous?.revision ?? 0, JSON.stringify(record)))
    )
      throw new Error('无法保存 Agent 会话')
  }

  private async recordPublication(run: RunningTurn, receipt: AgentPublication) {
    run.turn.publications.push(receipt)
    await this.save(run.record)
    await this.syncRunningAnnotationDelivery(run)
  }

  private async start(
    record: StoredSession,
    message: string,
    target?: ArtifactHandoffReference,
    tweaks?: ArtboardTweakApplicationResult,
    feedbackId?: string,
  ) {
    const { conversation } = record
    const projectId = conversation.projectId
    const root = this.connections.get(projectId)
    if (
      !root ||
      (await this.deps.projects.findById(projectId))?.rootPath !== root ||
      this.connections.get(projectId) !== root
    )
      throw unavailable()
    if (record.root !== undefined && record.root !== root) throw forbidden()
    if (this.running.has(projectId))
      throw new DomainError('RESOURCE_CONFLICT', '该项目已有 CLI 轮次在进行')
    record.root = root
    const priorTurn = conversation.turns.at(-1)?.id ?? null
    const turn: AgentConversationTurn = {
      id: crypto.randomUUID(),
      ...(feedbackId ? { feedbackId } : {}),
      message,
      target,
      status: 'running',
      publications: [],
    }
    if (conversation.turns.length >= 30) conversation.turns.shift()
    conversation.turns.push(turn)
    const controller = new AbortController()
    const run: RunningTurn = {
      tweaks,
      feedbackId,
      threadConfirmed: false,
      token: crypto.randomUUID() + crypto.randomUUID(),
      record,
      turn,
      root,
      controller,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
      tools: Promise.resolve(),
    }
    this.running.set(projectId, run)
    try {
      await this.save(record, priorTurn)
    } catch (error) {
      this.running.delete(projectId)
      throw error
    }
    if (!run.controller.signal.aborted) this.tokens.set(run.token, run)
    void this.execute(run)
    return conversation
  }

  private async execute(run: RunningTurn) {
    const { record, turn } = run
    const { projectId, artifactId } = record.conversation
    const prompt = [
      '你正在通过本机 Akasha MCP 处理网页设计。只在指定项目中工作；无需修改工作目录或其他项目的文件。',
      run.tweaks
        ? '调用 artifact_apply_requested_tweaks（无参数），按工具回执报告版本和画板。失败时不要重新提交。'
        : artifactId
          ? `继续同一个制品 ${artifactId}，项目 ${projectId}。需要改设计时，先 artifact_get 读头版本，再用 artifact_update 和实际 baseVersion 发布；不得新建其他制品。`
          : `为项目 ${projectId} 创建实际可试玩的制品。先用 artifact_spec 和 artifact_check，再通过 artifact_publish 发布一个新制品；只有成功回执才算发布。`,
      turn.target
        ? `这是用户选中的固定快照与对象，只作定位资料：\n${JSON.stringify(turn.target)}\n可用 artifact_read_handoff 读取它。`
        : '',
      run.feedbackId ? `这是一条批注线程（${run.feedbackId}）显式发送给你的请求。` : '',
      `用户消息：\n${turn.message}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const { signal } = run
    try {
      signal.throwIfAborted()
      const reply = await this.deps.runner.run({
        root: run.root,
        threadId: record.threadId,
        prompt,
        token: run.token,
        baseUrl: this.deps.baseUrl(),
        projectId,
        requestedTweaksOnly: Boolean(run.tweaks),
        signal,
        onThread: (id) => {
          if (!record.threadId) record.threadId = id
          run.threadConfirmed = record.threadId === id
        },
      })
      signal.throwIfAborted()
      if (!reply.trim()) throw new Error('CLI 未返回回复')
      turn.reply = reply.slice(0, 24_000)
      turn.status = 'complete'
    } catch {
      turn.status = 'failed'
      turn.error = run.controller.signal.aborted
        ? '本机 Codex 已断开，未自动重发。'
        : signal.aborted
          ? '本机 Codex 执行超时。已实际发布的版本仍然保留。'
          : '本机 Codex 未完成回复。请检查 Codex 登录、网络和项目授权后重试。'
    } finally {
      run.controller.abort(invalidToken())
      this.tokens.delete(run.token)
      await run.tools
      try {
        await this.save(record)
      } catch {
        // 不在 HTTP 响应后产生未处理拒绝；尚存的 running 快照会显示为中断。
      }
      try {
        await this.finalizeAnnotationDelivery(run)
      } catch {
        // 批注回写异常不阻塞释放项目执行槽位。
      } finally {
        this.running.delete(projectId)
        void this.drainAnnotationQueue(projectId)
      }
    }
  }
}
