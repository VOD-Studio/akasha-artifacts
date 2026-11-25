import type {
  AgentConnection,
  AgentConversation,
  AgentConversationStatus,
  ArtboardTweakApplication,
  ArtifactHandoffReference,
} from '@akasha/protocol'
import { requestJson } from '@/shared/api/request'

/**
 * CLI 回复、连接状态和可验证的发布回执由同一个本机会话读取。
 * 作品存在但没有有效绑定时，返回 `unbound`，且不携带会话。
 */
export async function fetchArtifactConversation(id: string, signal?: AbortSignal) {
  return requestJson<AgentConversationStatus>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/agent-session`,
    { signal },
  )
}

/**
 * 把消息交给该作品已绑定的本机 CLI 会话；回执不代表已回复或发布。
 *
 * @param input - `target` 固定作品和版本；应用画板参数时还须明确写入范围，不会自动改投新基准。
 * @throws 无有效绑定、CLI 离线或项目已有轮次时拒绝，不会改投其他会话。
 */
export async function sendArtifactConversation(
  id: string,
  input: {
    message: string
    target?: ArtifactHandoffReference
    tweakApplication?: ArtboardTweakApplication
  },
) {
  return requestJson<AgentConversation>(
    `/api/v1/artifacts/${encodeURIComponent(id)}/agent-session`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

/** 打开设计入口时读取仍有本机 CLI 授权的项目；忙碌连接也会列出，离线连接不列出。 */
export async function fetchAgentConnections(signal?: AbortSignal) {
  return requestJson<{ connections: AgentConnection[] }>('/api/v1/agent/connections', { signal })
}

/**
 * 在选定的授权项目中受理首条设计消息；作品链接必须等会话发布记录。
 *
 * @returns 受理后的会话；用其 `id` 读取同一会话的进度，而不是重发消息。
 */
export async function startAgentDesign(projectId: string, message: string) {
  return requestJson<AgentConversation>('/api/v1/agent/design', {
    method: 'POST',
    body: JSON.stringify({ projectId, message }),
  })
}

/**
 * 跟踪同一个受理会话的进度和发布记录，不会重新发送设计消息。
 *
 * @throws 会话标识不合法或找不到已授权的会话时拒绝并返回 `NOT_FOUND`。
 */
export async function fetchAgentDesignSession(id: string, signal?: AbortSignal) {
  return requestJson<AgentConversation>(`/api/v1/agent/sessions/${encodeURIComponent(id)}`, {
    signal,
  })
}
