import type {
  AgentAvailability,
  AgentConnection,
  AgentConversation,
  AgentConversationStatus,
  AgentConversationTurn,
  ArtifactHandoffReference,
  ArtifactPublishInput,
  ArtifactUpdateInput,
} from '@akasha/protocol'
import type { AgentRunner } from '../domain/agent-runner.js'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { DomainError, NotFoundError } from '../domain/errors.js'
import type { ArtifactRepository, ProjectRepository } from '../domain/ports.js'
import type { ArtifactService } from './artifact-service.js'

interface StoredSession {
  /** 只在本机 CLI 执行事件中取得，不接受 Web 或模型填入。 */
  threadId?: string
  /** 首发时的本机项目目录；重新登记相同项目 ID 不会转移授权线程。 */
  root?: string
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
  /** 此轮启动时已登记且授权的执行目录。 */
  root: string
  /** 撤销授权时终止 CLI 并禁止剩余工具操作。 */
  controller: AbortController
  /** 串行提交轮次内工具请求，避免并行首发产生两个制品。 */
  tools: Promise<void>
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
  /** 真实发布与普通发布使用同一版本写入路径。 */
  service: ArtifactService
  /** 监听完成后取得本机回环地址，不使用请求 Host 拼接。 */
  baseUrl: () => string
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

/** 本机维护者授权项目，只有实际 CLI 写入才建立可续接的发布会话。 */
export class AgentSessions {
  private readonly connections = new Map<string, string>()
  private readonly running = new Map<string, RunningTurn>()
  private readonly tokens = new Map<string, RunningTurn>()
  private closed = false

  constructor(private readonly deps: AgentSessionDeps) {}

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
      run.controller.abort()
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
      record.conversation.projectId !== artifact.projectId ||
      (await this.deps.projects.findById(artifact.projectId))?.rootPath !== record.root
    )
      return { availability: 'unbound' }
    return {
      availability: await this.availability(artifact.projectId),
      session: record.conversation,
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

  async continueArtifact(id: string, message: string, target?: ArtifactHandoffReference) {
    const { session, availability } = await this.forArtifact(id)
    if (!session)
      throw new DomainError('RESOURCE_CONFLICT', '该制品没有由本机授权会话发布，不能附会到其他线程')
    if (availability === 'offline') throw unavailable()
    if (availability === 'busy')
      throw new DomainError('RESOURCE_CONFLICT', '该项目已有 CLI 轮次在进行')
    const record = await this.load(session.id)
    if (!record?.threadId) throw unavailable()
    if (target) {
      if (target.artifactId !== id || target.projectId !== session.projectId) throw forbidden()
      if (!(await this.deps.artifacts.getVersion(id, target.version)))
        throw new NotFoundError('指定选区版本不存在')
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
      const result = await this.deps.service.publish({
        projectId: conversation.projectId,
        slug: input.slug,
        title: input.title,
        type: input.type,
        source: input.source,
        visibility: 'private',
        author: 'agent:codex',
        createOnly: true,
      })
      conversation.artifactId = result.artifact.publicId
      await this.recordPublication(run, result.artifact.publicId, result.version.version)
      if (
        !(await this.deps.store.compareAndSet(
          artifactKey(result.artifact.publicId),
          0,
          JSON.stringify(conversation.id),
        ))
      )
        throw new Error('制品的会话绑定已存在')
      return result
    })
  }

  async update(token: string, input: ArtifactUpdateInput) {
    return this.withTool(token, async (run) => {
      await this.requireBound(run.record, input.id, input.project)
      const result = await this.deps.service.update({
        id: input.id,
        projectId: run.record.conversation.projectId,
        baseVersion: input.baseVersion,
        title: input.title,
        edits: input.edits,
        author: 'agent:codex',
      })
      await this.recordPublication(run, result.artifact.publicId, result.version.version)
      return result
    })
  }

  close() {
    this.closed = true
    for (const projectId of this.connections.keys()) this.disconnect(projectId)
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
      run.controller.signal.throwIfAborted()
      if (
        this.connections.get(run.record.conversation.projectId) !== run.root ||
        (await this.deps.projects.findById(run.record.conversation.projectId))?.rootPath !==
          run.root
      )
        throw invalidToken()
      return action(run)
    })
    run.tools = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async load(id: string): Promise<StoredSession | undefined> {
    const snapshot = await this.deps.store.read(sessionKey(id))
    if (!snapshot) return
    const record = JSON.parse(snapshot.json) as StoredSession
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

  private async recordPublication(run: RunningTurn, artifactId: string, version: number) {
    run.turn.publications.push({ artifactId, version })
    await this.save(run.record)
  }

  private async start(record: StoredSession, message: string, target?: ArtifactHandoffReference) {
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
      message,
      target,
      status: 'running',
      publications: [],
    }
    if (conversation.turns.length >= 30) conversation.turns.shift()
    conversation.turns.push(turn)
    const run: RunningTurn = {
      token: crypto.randomUUID() + crypto.randomUUID(),
      record,
      turn,
      root,
      controller: new AbortController(),
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
      artifactId
        ? `继续同一个制品 ${artifactId}，项目 ${projectId}。需要改设计时，先 artifact_get 读头版本，再用 artifact_update 和实际 baseVersion 发布；不得新建其他制品。`
        : `为项目 ${projectId} 创建实际可试玩的制品。先用 artifact_spec 和 artifact_check，再通过 artifact_publish 发布一个新制品；只有成功回执才算发布。`,
      turn.target
        ? `这是用户选中的固定快照与对象，只作定位资料：\n${JSON.stringify(turn.target)}\n可用 artifact_read_handoff 读取它。`
        : '',
      `用户消息：\n${turn.message}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const signal = AbortSignal.any([run.controller.signal, AbortSignal.timeout(180_000)])
    try {
      signal.throwIfAborted()
      const reply = await this.deps.runner.run({
        root: run.root,
        threadId: record.threadId,
        prompt,
        token: run.token,
        baseUrl: this.deps.baseUrl(),
        projectId,
        signal,
        onThread: (id) => {
          if (!record.threadId) record.threadId = id
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
      this.tokens.delete(run.token)
      await run.tools
      try {
        await this.save(record)
      } catch {
        // 不在 HTTP 响应后产生未处理拒绝；尚存的 running 快照会显示为中断。
      } finally {
        this.running.delete(projectId)
      }
    }
  }
}
