import type { AgentActivityState } from '@akasha/protocol'

export type HarnessLifecycleEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'PreInvocation'

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
  artifactId?: string
  event: HarnessLifecycleEvent
  summary?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

// 异步轻量状态上报：驱动外壳顶栏实时切换「Agent 正在修改 / 空闲待命 / 离线」，超时或离线静默返回不拖慢宿主。
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
