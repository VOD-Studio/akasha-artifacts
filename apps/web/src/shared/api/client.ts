import {
  type Artifact,
  type DaemonStatus,
  type ElementRef,
  ErrorEnvelopeSchema,
  type Feedback,
  type FeedbackKind,
  type Project,
  type ReviewRound,
  type StateStreamSnapshot,
  type Version,
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
