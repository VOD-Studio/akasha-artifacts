import {
  type Artifact,
  type ArtifactSpecOutput,
  type ArtifactType,
  type Author,
  type DaemonStatus,
  type EditOp,
  type ElementRef,
  ErrorEnvelopeSchema,
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
} from '@akasha/protocol'
import { getApiBaseUrl } from '../config/runtime'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface DaemonLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  projectId?: string
  artifactId?: string
  message: string
}

export interface ArtifactDetailResponse {
  artifact: Artifact
  version: Version
  state: StateStreamSnapshot
  rounds: ReviewRound[]
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  if (!res.ok) {
    const errEnv = ErrorEnvelopeSchema.safeParse(parsed)
    if (errEnv.success) {
      throw new ApiError(
        res.status,
        errEnv.data.error.code,
        errEnv.data.error.message,
        errEnv.data.error.details,
      )
    }
    throw new ApiError(res.status, 'HTTP_ERROR', `请求失败（HTTP ${res.status}）`)
  }
  return parsed as T
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

export async function fetchArtifactDetail(
  id: string,
  version?: number,
): Promise<ArtifactDetailResponse> {
  const query = version !== undefined ? `?version=${version}` : ''
  return requestJson<ArtifactDetailResponse>(`/api/v1/artifacts/${encodeURIComponent(id)}${query}`)
}

export async function fetchArtifactVersions(id: string): Promise<{ versions: Version[] }> {
  return requestJson<{ versions: Version[] }>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/versions`,
  )
}

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
  element?: ElementRef | null
  body: string
}

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

export async function fetchArtifactFeedback(
  id: string,
  includeDrafts = true,
): Promise<{ items: Feedback[]; rounds: ReviewRound[]; cursor: string }> {
  const params = new URLSearchParams({
    id,
    includeDrafts: String(includeDrafts),
    detail: 'true',
  })
  return requestJson<{ items: Feedback[]; rounds: ReviewRound[]; cursor: string }>(
    `/api/v1/feedback?${params.toString()}`,
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

// 同步当前浏览器选区与未提交草稿到本机 Daemon，供终端 Hook 在用户发消息时无感注入上下文。
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

export async function fetchArtifactSpec(type: ArtifactType): Promise<ArtifactSpecOutput> {
  return requestJson<ArtifactSpecOutput>(`/api/v1/specs/${encodeURIComponent(type)}`)
}

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

// L3 人类直接保存代码版本：显式声明 baseVersion 与 author='human:web'，落后于 headVersion 时由服务端返回 409 冲突详情。
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

export type VisualEditCommand = { op: EditOp } | { undoVersion: number }

export async function fetchVisualEditTarget(
  id: string,
  input: { project: string; baseVersion: number; loc: string },
): Promise<{ target: VisualEditTarget | null }> {
  const query = new URLSearchParams({
    project: input.project,
    baseVersion: String(input.baseVersion),
    loc: input.loc,
  })
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit?${query}`)
}

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

export async function previewVisualEdit(
  id: string,
  input: { project: string; baseVersion: number } & VisualEditCommand,
): Promise<{ source: string }> {
  return requestJson(`/api/v1/artifacts/${encodeURIComponent(id)}/visual-edit/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

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
