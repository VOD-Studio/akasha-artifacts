import {
  type Artifact,
  type ArtifactAckFeedbackOutput,
  type ArtifactAwaitFeedbackOutput,
  type ArtifactCheckOutput,
  type ArtifactGetOutput,
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

  // 把 409 版本冲突转换为对模型清晰可执行的合并重试说明
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
  baseUrl: string
  token?: string
  defaultProject?: string
  defaultAuthor?: Author
  fetchImpl?: typeof fetch
}

// 无状态 HTTP 客户端：供 MCP Server 与 CLI 复用，对接本地 Daemon 或云端 Hub 的同一套 /api/v1 协议。
export class AkashaHttpClient {
  readonly baseUrl: string
  private readonly token?: string
  private readonly defaultProject?: string
  private readonly defaultAuthor: Author
  private readonly fetchFn: typeof fetch

  constructor(options: AkashaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    this.defaultProject = options.defaultProject
    this.defaultAuthor = options.defaultAuthor ?? 'agent:mcp'
    this.fetchFn = options.fetchImpl ?? fetch
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`
    }
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
    }
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
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
