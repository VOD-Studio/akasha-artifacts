import {
  type AgentConnection,
  type AgentConversation,
  type AgentConversationStatus,
  type AnnotationThread,
  type Artifact,
  type ArtifactHandoffReference,
  type ArtifactSharedAccess,
  type ArtifactShareInput,
  type ArtifactSpecOutput,
  type ArtifactStorageUsage,
  ArtifactStorageUsageSchema,
  type ArtifactTransferInput,
  type ArtifactType,
  type Author,
  type DaemonStatus,
  type EditOp,
  type ElementRef,
  type Feedback,
  type FeedbackKind,
  type JsonPatchOp,
  type Project,
  type ReviewGroup,
  type ReviewRound,
  type StateStreamSnapshot,
  type Verdict,
  type Version,
  type Visibility,
  type WithdrawnArtifact,
} from '@akasha/protocol'
import { ApiError } from './error'
import { requestJson } from './request'

export interface DaemonLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  projectId?: string
  artifactId?: string
  message: string
}

/** `GET /api/v1/artifacts/:id` 的响应。 */
export interface ArtifactDetailResponse {
  artifact: Artifact
  /** 这里是实际返回的快照，不一定等于作品的头版本。 */
  version: Version
  state: StateStreamSnapshot
  rounds: ReviewRound[]
  /** 签名分享授予的版本和权限；未设置时不是分享会话。 */
  access?: ArtifactSharedAccess
}

/** 签发分享链接；普通定位链接不经过这个接口。 */
export async function createArtifactShare(
  id: string,
  input: ArtifactShareInput,
): Promise<{ url: string; expiresAt: string }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 读取当前会话的管理权限；能打开作品不代表能修改、撤下或分享。 */
export async function fetchArtifactManagement(id: string): Promise<{ canManage: boolean }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/management`)
}

/** 服务端固定复制版本并原子移动；两种操作都校验源与目标项目。 */
export async function transferArtifact(
  id: string,
  input: ArtifactTransferInput,
): Promise<{ artifact: Artifact; version?: Version }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/transfer`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 只更改展示名称，不产生新版本，也不改变已有定位链接。 */
export async function renameArtifact(id: string, title: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

/** 撤下不删除书签指向的记录，但会在服务端撤销所有已发签名。 */
export async function withdrawArtifact(id: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function fetchWithdrawnArtifacts(): Promise<{ items: WithdrawnArtifact[] }> {
  return requestJson('/api/v1/withdrawn-artifacts')
}

/** 恢复原作品链接；撤下时失效的签名分享不会恢复。 */
export async function restoreArtifact(id: string): Promise<{ artifact: Artifact }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

export async function fetchArtifactFavorites(): Promise<{ artifactIds: string[] }> {
  return requestJson('/api/v1/favorites')
}

export async function setArtifactFavorite(
  id: string,
  favorite: boolean,
): Promise<{ favorite: boolean }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/favorite`, {
    method: 'PUT',
    body: JSON.stringify({ favorite }),
  })
}

export async function fetchArtifactStorageUsage(id: string): Promise<ArtifactStorageUsage> {
  const usage = await requestJson<unknown>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/storage/usage`,
  )
  return ArtifactStorageUsageSchema.parse(usage)
}

export async function fetchDaemonStatus(): Promise<DaemonStatus> {
  return requestJson<DaemonStatus>('/api/v1/daemon/status')
}

export async function fetchDaemonLogs(
  projectId?: string,
  limit = 100,
): Promise<{ entries: DaemonLogEntry[] }> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (projectId) params.set('projectId', projectId)
  return requestJson<{ entries: DaemonLogEntry[] }>(`/api/v1/daemon/logs?${params.toString()}`)
}

/** 返回表示 Daemon 已接受停机；不代表进程已退出。 */
export async function stopDaemon(): Promise<{ ok: true; status: 'stopping' }> {
  return requestJson<{ ok: true; status: 'stopping' }>('/api/v1/daemon/shutdown', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function fetchProjects(): Promise<{ projects: Project[] }> {
  return requestJson<{ projects: Project[] }>('/api/v1/projects')
}

export async function removeProject(id: string): Promise<{ ok: true; id: string }> {
  return requestJson<{ ok: true; id: string }>(`/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function fetchArtifacts(projectId?: string): Promise<{ artifacts: Artifact[] }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ artifacts: Artifact[] }>(`/api/v1/artifacts${query}`)
}

/** CLI 回复、连接状态和可验证的发布回执由同一个本机会话读取。 */
export async function fetchArtifactConversation(id: string, signal?: AbortSignal) {
  return requestJson<AgentConversationStatus>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/agent-session`,
    { signal },
  )
}

/** 把消息交给该作品已绑定的本机 CLI 会话；回执不代表已回复或发布。 */
export async function sendArtifactConversation(
  id: string,
  input: { message: string; target?: ArtifactHandoffReference },
) {
  return requestJson<AgentConversation>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/agent-session`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export async function fetchAgentConnections(signal?: AbortSignal) {
  return requestJson<{ connections: AgentConnection[] }>('/api/v1/agent/connections', { signal })
}

/** 在选定的授权项目中受理首条设计消息；作品链接必须等会话发布记录。 */
export async function startAgentDesign(projectId: string, message: string) {
  return requestJson<AgentConversation>('/api/v1/agent/design', {
    method: 'POST',
    body: JSON.stringify({ projectId, message }),
  })
}

/** 跟踪同一个受理会话的进度和发布记录，不会重新发送设计消息。 */
export async function fetchAgentDesignSession(id: string, signal?: AbortSignal) {
  return requestJson<AgentConversation>(`/api/v1/agent/sessions/${encodeURIComponent(id)}`, {
    signal,
  })
}

/** 不传 `version` 时请求头版本；传入时读取固定快照，不回退到头版本。 */
export async function fetchArtifactDetail(
  id: string,
  version?: number,
  signal?: AbortSignal,
): Promise<ArtifactDetailResponse> {
  const query = version !== undefined ? `?version=${version}` : ''
  return requestJson<ArtifactDetailResponse>(
    `/api/v1/artifacts/${encodeURIComponent(id)}${query}`,
    {
      signal,
    },
  )
}

export async function fetchArtifactVersions(id: string): Promise<{ versions: Version[] }> {
  return requestJson<{ versions: Version[] }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/versions`,
  )
}

/** 以历史快照创建新的头版本，不覆盖旧版本；`baseVersion` 防止覆盖并发提交。 */
export async function revertArtifactVersion(
  id: string,
  input: { targetVersion: number; baseVersion: number },
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson<{ artifact: Artifact; version: Version }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/revert`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export interface SubmitFeedbackInput {
  project?: string
  version: number
  roundId?: string | null
  groupId?: string | null
  kind: FeedbackKind
  /** `agent` 表示面向 Agent；有轮次的草稿在提交本轮后才可被消费。 */
  audience?: Feedback['audience']
  element?: ElementRef | null
  body: string
}

/** 给指定版本写批注、修改记录或运行错误；返回反馈记录，不表示 Agent 已消费。 */
export async function submitArtifactFeedback(
  id: string,
  input: SubmitFeedbackInput,
): Promise<{ feedback: Feedback }> {
  return requestJson<{ feedback: Feedback }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/feedback`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 读取服务端授权的反馈和讨论线程；请求包含当前调用者可读取的草稿。 */
export async function fetchArtifactFeedback(
  id: string,
): Promise<{ items: Feedback[]; threads: Record<string, AnnotationThread> }> {
  return requestJson<{ items: Feedback[]; threads: Record<string, AnnotationThread> }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/feedback?includeDrafts=true`,
  )
}

/** 可在任意已授权的历史版本下继续讨论，不改变 Agent 消费状态。 */
export type AnnotationThreadAction =
  | { kind: 'reply'; body: string }
  | { kind: 'resolve'; resolved: boolean }

export async function updateAnnotationThread(
  artifactId: string,
  id: string,
  action: AnnotationThreadAction,
): Promise<unknown> {
  return requestJson(
    `/api/v1/artifacts/${encodeURIComponent(artifactId)}/feedback/${encodeURIComponent(id)}/${action.kind === 'reply' ? 'replies' : 'resolve'}`,
    {
      method: 'POST',
      body: JSON.stringify(
        action.kind === 'reply' ? { body: action.body } : { resolved: action.resolved },
      ),
    },
  )
}

export async function openReviewRound(
  id: string,
  input: { project?: string; groups: ReviewGroup[] },
): Promise<{ round: ReviewRound }> {
  return requestJson<{ round: ReviewRound }>(`/api/v1/artifacts/${encodeURIComponent(id)}/rounds`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 提交本轮，使面向 Agent 的轮次反馈可被消费。不等待 Agent 回复。 */
export async function submitReviewRound(
  id: string,
  roundId: string,
  projectId?: string,
): Promise<{ round: ReviewRound }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/rounds/${encodeURIComponent(roundId)}/submit${query}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

/** 将轮次退回草拟状态；已经提交的反馈不会被删除。 */
export async function withdrawReviewRound(
  id: string,
  roundId: string,
  projectId?: string,
): Promise<{ round: ReviewRound }> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/rounds/${encodeURIComponent(roundId)}/withdraw${query}`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
}

export interface RecordHumanDecisionInput {
  project?: string
  roundId: string
  groupId: string
  choice?: string
  verdict?: Verdict
  note?: string
  submitRound?: boolean
}

/** 记录人的选择或验收结论；只有显式设定 `submitRound` 才同时提交轮次。 */
export async function recordHumanDecision(
  id: string,
  input: RecordHumanDecisionInput,
): Promise<{ round: ReviewRound }> {
  return requestJson<{ round: ReviewRound }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/verdict`,
    {
      method: 'POST',
      body: JSON.stringify({ ...input, fromAgent: false }),
    },
  )
}

/**
 * 把浏览器当前的选区与未提交草稿同步到本机 Daemon，供终端 Hook 在用户发消息时注入上下文。
 *
 * @remarks 同步失败时静默返回，不阻断浏览器里的交互。
 */
export async function syncProjectSelection(
  projectId: string,
  input: { artifactId?: string; element: ElementRef | null; draftText?: string },
): Promise<void> {
  try {
    await requestJson(`/api/v1/projects/${encodeURIComponent(projectId)}/selection`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  } catch {
    // 选区同步失败不阻断浏览器交互
  }
}

/** 读取作品类型公开的检查与参数规格，与某个版本的运行数据无关。 */
export async function fetchArtifactSpec(type: ArtifactType): Promise<ArtifactSpecOutput> {
  return requestJson<ArtifactSpecOutput>(`/api/v1/specs/${encodeURIComponent(type)}`)
}

/** 更新独立于源码版本的运行状态；返回已应用补丁后的序号与快照。 */
export async function pushArtifactState(
  id: string,
  input: { project?: string; patch: JsonPatchOp[] },
): Promise<{ publicId: string; seq: number; snapshot: Record<string, unknown> }> {
  return requestJson<{ publicId: string; seq: number; snapshot: Record<string, unknown> }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/state`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 人类保存版本时的发布入参；`author` 缺省为 `human:web`。 */
export interface PublishHumanVersionInput {
  project: string
  slug: string
  title: string
  type: ArtifactType
  source: string
  baseVersion: number
  visibility?: Visibility
  author?: Author
}

/**
 * 保存代码编辑或画布操作产生的新版本，不改写原快照。
 *
 * @remarks `baseVersion` 落后于头版本时服务端返回 409，`ApiError.details` 里带冲突详情。
 */
export async function publishHumanVersion(
  input: PublishHumanVersionInput,
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson<{ artifact: Artifact; version: Version }>('/api/v1/artifacts', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      author: input.author ?? 'human:web',
    }),
  })
}

export interface VisualEditTarget {
  tagName: string
  text: string | null
  className: string
  order: { parentLoc: string; siblings: Array<{ loc: string; label: string }> } | null
}

export type VisualEditCommand = { op: EditOp; boardId?: string } | { undoVersion: number }

/** 定位可修改的源码元素；`target: null` 表示该基准版本没有可编辑目标。 */
export async function fetchVisualEditTarget(
  id: string,
  input: { project: string; baseVersion: number; loc: string; boardId?: string },
): Promise<{ target: VisualEditTarget | null }> {
  const query = new URLSearchParams({
    project: input.project,
    baseVersion: String(input.baseVersion),
    loc: input.loc,
  })
  if (input.boardId !== undefined) query.set('boardId', input.boardId)
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit?${query}`)
}

/** 查找当前基准上的可撤销直改版本；为空则不提供撤销。 */
export async function fetchVisualUndo(
  id: string,
  input: { project: string; baseVersion: number },
): Promise<{ undoVersion: number | null }> {
  const query = new URLSearchParams({
    project: input.project,
    baseVersion: String(input.baseVersion),
  })
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit?${query}`)
}

/** 计算应用编辑后的源码，不发布版本、也不通知 Agent。 */
export async function previewVisualEdit(
  id: string,
  input: { project: string; baseVersion: number } & VisualEditCommand,
): Promise<{ source: string }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** 提交元素编辑或撤销，返回服务端已写入的版本；版本冲突由调用方处理。 */
export async function saveVisualEdit(
  id: string,
  input: { project: string; baseVersion: number } & VisualEditCommand,
): Promise<{ artifact: Artifact; version: Version }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export interface VersionConflictDetails {
  artifactId?: string
  baseVersion: number
  headVersion: number
  diff: string
  authors: string[]
}

/** 只提取服务端的版本冲突详情，其他错误仍由调用方按原样处理。 */
export function parseVersionConflictDetails(err: unknown): VersionConflictDetails | null {
  if (!(err instanceof ApiError)) return null
  if (err.status !== 409 || err.code !== 'VERSION_CONFLICT') return null
  if (!err.details || typeof err.details !== 'object') return null
  const d = err.details as Record<string, unknown>
  if (typeof d.headVersion !== 'number' || typeof d.baseVersion !== 'number') return null
  return {
    artifactId: typeof d.artifactId === 'string' ? d.artifactId : undefined,
    baseVersion: d.baseVersion,
    headVersion: d.headVersion,
    diff: typeof d.diff === 'string' ? d.diff : '',
    authors: Array.isArray(d.authors)
      ? d.authors.filter((a): a is string => typeof a === 'string')
      : [],
  }
}
