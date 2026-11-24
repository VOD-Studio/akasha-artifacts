import type {
  AgentConnection,
  AgentConversation,
  AgentConversationStatus,
  Artifact,
  ArtifactHandoffReference,
  DaemonStatus,
  EditOp,
  ElementRef,
  Project,
  Version,
} from '@akasha/protocol'
import { requestJson } from './request'

export interface DaemonLogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  projectId?: string
  artifactId?: string
  message: string
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
