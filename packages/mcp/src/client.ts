import {
  type Artifact,
  type ArtifactAckFeedbackOutput,
  type ArtifactAwaitFeedbackOutput,
  type ArtifactCheckOutput,
  type ArtifactGetOutput,
  type ArtifactHandoffReference,
  type ArtifactPublishInput,
  type ArtifactPullFeedbackOutput,
  type ArtifactRecordVerdictInput,
  type ArtifactRecordVerdictOutput,
  type ArtifactSpecOutput,
  type ArtifactType,
  type ArtifactUpdateInput,
  type Author,
  ErrorEnvelopeSchema,
  type JsonPatchOp,
  type Version,
  VersionConflictDetailsSchema,
} from '@akasha/protocol'

/**
 * 服务端的非 2xx 响应，或响应不是合法 JSON。
 *
 * @remarks `code` 是协议错误码；响应体不是错误信封时为 `HTTP_ERROR`，
 * 不是 JSON 时为 `INVALID_RESPONSE`。
 */
export class AkashaApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AkashaApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /**
   * 转成给模型看的说明；`VERSION_CONFLICT` 会展开成「先读最新版本、按 diff 合并、再提交」的指引。
   */
  toAgentMessage(): string {
    if (this.code === 'VERSION_CONFLICT') {
      const parsed = VersionConflictDetailsSchema.safeParse(this.details)
      if (parsed.success) {
        const d = parsed.data
        const who = d.authors.length > 0 ? d.authors.join(', ') : '其他作者'
        return [
          `版本冲突（409）：你的写入基于 v${d.baseVersion}，但当前最新版本已是 v${d.headVersion}（修改者：${who}）。`,
          '请勿覆盖他人改动。先调用 artifact_get 读取最新版本并合并以下差异，再以 baseVersion=' +
            `${d.headVersion} 重新提交：`,
          '```diff',
          d.diff || '(仅元数据变更)',
          '```',
        ].join('\n')
      }
    }
    const detailText =
      this.details !== undefined ? `\n详情：${JSON.stringify(this.details, null, 2)}` : ''
    return `[${this.code}] ${this.message}${detailText}`
  }
}

export interface AkashaClientOptions {
  // 服务端根地址，结尾的 / 会被去掉
  baseUrl: string
  // 以 Bearer 头随每个请求发送
  token?: string
  // 各方法 `project` 参数的缺省值
  defaultProject?: string
  // 写入版本时的作者，缺省 agent:mcp
  defaultAuthor?: Author
  fetchImpl?: typeof fetch
  // 本机托管 CLI 用独立的限轮次工具路径，不持有普通 Daemon 会话凭证。
  scopedAgentTurn?: boolean
  // 共享 Daemon 平滑升级更换 token/端口后，遇 401 或连接断开时回调刷新凭据并自动重试一次
  resolveConnection?: () => Promise<{ baseUrl: string; token?: string }>
}

/**
 * 无状态 HTTP 客户端，供 MCP Server 与 CLI 复用，对接本地 Daemon 或云端 Hub 的同一套 `/api/v1`。
 *
 * @remarks 连接失败或收到 401 时，若配置了 `resolveConnection`，刷新地址与令牌后重试一次。
 * 非 2xx 响应一律抛 `AkashaApiError`。
 */
export class AkashaHttpClient {
  baseUrl: string
  private token?: string
  private readonly defaultProject?: string
  private readonly defaultAuthor: Author
  private readonly fetchFn: typeof fetch
  private readonly resolveConnection?: () => Promise<{ baseUrl: string; token?: string }>
  private readonly scopedAgentTurn: boolean

  constructor(options: AkashaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.defaultProject = options.defaultProject
    this.defaultAuthor = options.defaultAuthor ?? 'agent:mcp'
    this.fetchFn = options.fetchImpl ?? fetch
    this.resolveConnection = options.resolveConnection
    this.scopedAgentTurn = options.scopedAgentTurn ?? false
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    const endpoint = this.scopedAgentTurn
      ? `/api/v1/agent/tool${path.slice('/api/v1'.length)}`
      : path
    let res: Response
    try {
      res = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (err) {
      if (!retried && this.resolveConnection) {
        const refreshed = await this.resolveConnection()
        this.baseUrl = refreshed.baseUrl.replace(/\/+$/, '')
        this.token = refreshed.token
        return this.request<T>(method, path, body, true)
      }
      throw err
    }

    if (res.status === 401 && !retried && this.resolveConnection) {
      const refreshed = await this.resolveConnection()
      this.baseUrl = refreshed.baseUrl.replace(/\/+$/, '')
      this.token = refreshed.token
      return this.request<T>(method, path, body, true)
    }
    const text = await res.text()
    let json: unknown = {}
    if (text) {
      try {
        json = JSON.parse(text) as unknown
      } catch {
        if (!res.ok) {
          throw new AkashaApiError(res.status, 'HTTP_ERROR', text)
        }
        throw new AkashaApiError(
          res.status,
          'INVALID_RESPONSE',
          `响应不是合法 JSON：${text.slice(0, 120)}`,
        )
      }
    }
    if (!res.ok) {
      const env = ErrorEnvelopeSchema.safeParse(json)
      if (env.success) {
        throw new AkashaApiError(
          res.status,
          env.data.error.code,
          env.data.error.message,
          env.data.error.details,
        )
      }
      throw new AkashaApiError(res.status, 'HTTP_ERROR', text || `HTTP ${res.status}`)
    }
    return json as T
  }

  /** 制品页面地址：`<baseUrl>/a/<publicId>`。 */
  artifactUrl(publicId: string): string {
    return `${this.baseUrl}/a/${publicId}`
  }

  async publish(input: ArtifactPublishInput): Promise<{
    artifact: Artifact
    version: Version
    url: string
    specHint?: string
  }> {
    const data = await this.request<{ artifact: Artifact; version: Version; specHint?: string }>(
      'POST',
      '/api/v1/artifacts',
      {
        ...input,
        project: input.project ?? this.defaultProject,
        author: this.defaultAuthor,
      },
    )
    return { ...data, url: this.artifactUrl(data.artifact.publicId) }
  }

  async update(input: ArtifactUpdateInput): Promise<{
    artifact: Artifact
    version: Version
    url: string
  }> {
    const { id, ...rest } = input
    const data = await this.request<{ artifact: Artifact; version: Version }>(
      'PATCH',
      `/api/v1/artifacts/${encodeURIComponent(id)}`,
      {
        ...rest,
        project: rest.project ?? this.defaultProject,
        author: this.defaultAuthor,
      },
    )
    return { ...data, url: this.artifactUrl(data.artifact.publicId) }
  }

  async check(input: {
    type: ArtifactType
    source: string
    project?: string
  }): Promise<ArtifactCheckOutput> {
    return this.request<ArtifactCheckOutput>('POST', '/api/v1/artifacts/check', {
      ...input,
      project: input.project ?? this.defaultProject,
    })
  }

  async spec(type: ArtifactType): Promise<ArtifactSpecOutput> {
    return this.request<ArtifactSpecOutput>('GET', `/api/v1/specs/${encodeURIComponent(type)}`)
  }

  async pushState(input: {
    id: string
    project?: string
    patch: JsonPatchOp[]
  }): Promise<{ publicId: string; seq: number }> {
    return this.request<{ publicId: string; seq: number }>(
      'POST',
      `/api/v1/artifacts/${encodeURIComponent(input.id)}/state`,
      {
        project: input.project ?? this.defaultProject,
        patch: input.patch,
      },
    )
  }

  async getArtifact(input: {
    id: string
    project?: string
    version?: number
  }): Promise<ArtifactGetOutput> {
    const qs = new URLSearchParams()
    const proj = input.project ?? this.defaultProject
    if (proj) qs.set('projectId', proj)
    if (input.version !== undefined) qs.set('version', String(input.version))
    const suffix = qs.size > 0 ? `?${qs.toString()}` : ''
    return this.request<ArtifactGetOutput>(
      'GET',
      `/api/v1/artifacts/${encodeURIComponent(input.id)}${suffix}`,
    )
  }

  /** 读取仍由当前 MCP 项目授权的指定快照，不接受交接正文切换项目。 */
  async getHandoffVersion(
    input: ArtifactHandoffReference,
  ): Promise<Pick<ArtifactGetOutput, 'artifact' | 'version'>> {
    if (!this.defaultProject || input.projectId !== this.defaultProject) {
      throw new AkashaApiError(403, 'FORBIDDEN', '交接不属于此 CLI 会话绑定的项目')
    }
    const { artifact, version } = await this.getArtifact({
      id: input.artifactId,
      project: this.defaultProject,
      version: input.version,
    })
    if (artifact.projectId !== this.defaultProject || artifact.publicId !== input.artifactId) {
      throw new AkashaApiError(403, 'FORBIDDEN', '指定制品不属于当前 CLI 项目')
    }
    if (version.artifactId !== input.artifactId || version.version !== input.version) {
      throw new AkashaApiError(404, 'NOT_FOUND', '未读到交接指定的固定快照')
    }
    return { artifact, version }
  }

  async pullFeedback(input: {
    id?: string
    project?: string
    after?: string
    includeDrafts?: boolean
    detail?: boolean
  }): Promise<ArtifactPullFeedbackOutput> {
    const qs = new URLSearchParams()
    if (input.id) qs.set('id', input.id)
    const proj = input.project ?? this.defaultProject
    if (proj) qs.set('projectId', proj)
    if (input.after) qs.set('after', input.after)
    if (input.includeDrafts) qs.set('includeDrafts', 'true')
    if (input.detail === false) qs.set('detail', 'false')
    const suffix = qs.size > 0 ? `?${qs.toString()}` : ''
    return this.request<ArtifactPullFeedbackOutput>('GET', `/api/v1/feedback${suffix}`)
  }

  async ackFeedback(input: {
    receipt: string
    resolveIds?: string[]
  }): Promise<ArtifactAckFeedbackOutput> {
    return this.request<ArtifactAckFeedbackOutput>('POST', '/api/v1/feedback/ack', input)
  }

  async awaitFeedback(input: {
    id: string
    project?: string
    after?: string
    timeoutSec?: number
  }): Promise<ArtifactAwaitFeedbackOutput> {
    return this.request<ArtifactAwaitFeedbackOutput>('POST', '/api/v1/feedback/await', {
      ...input,
      project: input.project ?? this.defaultProject,
    })
  }

  // 固定以 Agent 身份回写，因此允许改写非 drafting 的轮次
  async recordVerdict(input: ArtifactRecordVerdictInput): Promise<ArtifactRecordVerdictOutput> {
    const { id, ...rest } = input
    return this.request<ArtifactRecordVerdictOutput>(
      'POST',
      `/api/v1/artifacts/${encodeURIComponent(id)}/verdict`,
      {
        ...rest,
        project: rest.project ?? this.defaultProject,
        fromAgent: true,
      },
    )
  }
}
