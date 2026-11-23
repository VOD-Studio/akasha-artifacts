import type { AgentActivityState } from '@akasha/protocol'

/** 宿主 Harness 的生命周期事件名。 */
export type HarnessLifecycleEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreInvocation'

/**
 * 把宿主事件映射成 Agent 活跃状态：调用工具前为 `editing`，回合内的其他事件为 `idle`，
 * 会话结束为 `offline`。
 */
export function mapHarnessEventToActivity(event: HarnessLifecycleEvent): AgentActivityState {
  switch (event) {
    case 'PreToolUse':
      return 'editing'
    case 'PostToolUse':
    case 'Stop':
    case 'UserPromptSubmit':
    case 'PreInvocation':
      return 'idle'
    case 'SessionEnd':
      return 'offline'
  }
}

export interface ReportActivityOptions {
  baseUrl: string
  token?: string
  projectId: string
  // 省略表示整个项目的状态
  artifactId?: string
  // 触发本次上报的宿主事件，决定上报的状态
  event: HarnessLifecycleEvent
  summary?: string
  // 请求超时（毫秒），缺省 1500
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * 向服务端上报一次 Agent 活跃状态。
 *
 * @returns 服务端是否以 2xx 应答；超时、离线或非 2xx 都返回 false，不向宿主抛错。
 */
export async function reportHookActivity(options: ReportActivityOptions): Promise<boolean> {
  const f = options.fetchImpl ?? fetch
  const state = mapHarnessEventToActivity(options.event)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 1500)
  try {
    const res = await f(`${options.baseUrl.replace(/\/$/, '')}/api/v1/agent/activity`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify({
        projectId: options.projectId,
        ...(options.artifactId ? { artifactId: options.artifactId } : {}),
        state,
        ...(options.summary ? { summary: options.summary } : {}),
      }),
    })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
