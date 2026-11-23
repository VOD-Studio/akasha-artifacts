import { setTimeout as delay } from 'node:timers/promises'
import { AgentConversationSchema, AgentDesignInputSchema } from '@akasha/protocol'
import { ensureDaemon } from '../daemon/lifecycle.js'

interface AgentCommandOptions {
  action?: string
  projectDir: string
  homeDir?: string
  message?: string
}

/** 终端用本机 bearer 明确授权。Web 不持有此命令的终端权限。 */
export async function runAgentCommand({
  action,
  projectDir,
  homeDir,
  message,
}: AgentCommandOptions) {
  if (action !== 'connect' && action !== 'disconnect' && action !== 'design') {
    console.error(
      '用法：akasha agent <connect|disconnect|design> [--project <路径>] [--prompt <设计描述>]',
    )
    return 2
  }
  if (action === 'design' && !message?.trim()) {
    console.error('请用 --prompt 提供设计描述')
    return 2
  }
  try {
    const daemon = await ensureDaemon({ projectDir, homeDir })
    const projectId = daemon.projectId
    if (!projectId) throw new Error('未能在 Daemon 中登记指定项目，未授权 CLI')
    const headers = {
      Authorization: `Bearer ${daemon.state.token}`,
      'Content-Type': 'application/json',
    }
    const request = async (path: string, method: string, body?: unknown) => {
      const res = await fetch(`${daemon.baseUrl}/api/v1/agent/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      const data = (await res.json()) as { error?: { message?: string } }
      if (!res.ok) throw new Error(data.error?.message ?? `本机 Daemon 请求失败（${res.status}）`)
      return data
    }
    if (action === 'connect') {
      await request('connections', 'POST', { projectId })
      console.log(`Codex 已授权接收 ${projectId} 的本机设计请求。`)
      return 0
    }
    if (action === 'disconnect') {
      await request(`connections/${encodeURIComponent(projectId)}`, 'DELETE')
      console.log(`Codex 已断开 ${projectId}；原有会话和制品仍保留。`)
      return 0
    }
    const input = AgentDesignInputSchema.parse({ projectId, message })
    let session = AgentConversationSchema.parse(await request('design', 'POST', input))
    console.log(`已交付本机 Codex · 会话 ${session.id}`)
    const until = Date.now() + 185_000
    while (session.turns.at(-1)?.status === 'running' && Date.now() < until) {
      await delay(1000)
      session = AgentConversationSchema.parse(await request(`sessions/${session.id}`, 'GET'))
    }
    const turn = session.turns.at(-1)
    for (const { artifactId, version } of turn?.publications ?? [])
      console.log(`已发布 v${version}：${daemon.baseUrl}/a/${artifactId}/v/${version}`)
    if (turn?.reply) console.log(turn.reply)
    if (turn?.status === 'complete' && session.artifactId) return 0
    console.error(turn?.error ?? '会话未确认发布制品；没有创建占位稿。')
    return 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : '本机 Codex 请求失败')
    return 1
  }
}

/** 校验 MCP 子进程的限轮次地址；不回退到整机 Daemon 凭证。 */
export function readScopedAgentEnvironment() {
  const base = process.env.AKASHA_TURN_URL
  const token = process.env.AKASHA_TURN_TOKEN
  const defaultProject = process.env.AKASHA_TURN_PROJECT
  const url = base ? URL.parse(base) : null
  if (
    url?.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.href !== `${url.origin}/` ||
    !url.port ||
    !token ||
    !defaultProject
  )
    throw new Error('缺少本机 Codex 轮次的受限 MCP 配置')
  return { baseUrl: url.origin, token, defaultProject, scopedAgentTurn: true }
}
