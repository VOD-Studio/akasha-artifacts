import { execFile, spawn } from 'node:child_process'
import type { AgentRunner, AgentRunnerLaunch } from '@akasha/server'

const scopedEnv = ['AKASHA_TURN_URL', 'AKASHA_TURN_TOKEN', 'AKASHA_TURN_PROJECT']
const scopedTools = [
  'artifact_spec',
  'artifact_check',
  'artifact_publish',
  'artifact_update',
  'artifact_get',
  'artifact_read_handoff',
]
const threadPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i

interface CodexEvent {
  type?: string
  thread_id?: string
  item?: { type?: string; text?: string }
}

function readEvent(line: string): CodexEvent | undefined {
  try {
    const event: unknown = JSON.parse(line)
    return event && typeof event === 'object' ? (event as CodexEvent) : undefined
  } catch {
    return undefined
  }
}

/** 只恢复本机启动的真实线程；模型输出的文本不能设定线程或认证信息。 */
export function createCodexRunner(akashaEntrypoint: string): AgentRunner {
  return {
    check: (root) =>
      new Promise((resolve, reject) => {
        execFile(
          'codex',
          ['login', 'status'],
          { cwd: root, timeout: 5000, windowsHide: true },
          (error) => {
            if (error) reject(error)
            else resolve()
          },
        )
      }),
    run: (request) => runCodex(akashaEntrypoint, request),
  }
}

async function runCodex(akashaEntrypoint: string, request: AgentRunnerLaunch) {
  const { root, threadId, prompt, token, baseUrl, projectId, signal, onThread } = request
  if (threadId && !threadPattern.test(threadId)) throw new Error('无效的 Codex 线程')
  const args = [
    'exec',
    ...(threadId ? ['resume'] : []),
    '--json',
    '--ignore-user-config',
    '--skip-git-repo-check',
  ]
  const tools = request.requestedTweaksOnly
    ? ['artifact_read_handoff', 'artifact_apply_requested_tweaks']
    : scopedTools
  const config = [
    'approval_policy="never"',
    'sandbox_mode="read-only"',
    'shell_environment_policy.inherit="none"',
    `mcp_servers.akasha.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.akasha.args=${JSON.stringify([akashaEntrypoint, 'mcp', '--agent-turn'])}`,
    `mcp_servers.akasha.env_vars=${JSON.stringify(scopedEnv)}`,
    `mcp_servers.akasha.enabled_tools=${JSON.stringify(tools)}`,
    ...tools.map((tool) => `mcp_servers.akasha.tools.${tool}.approval_mode="approve"`),
  ]
  for (const entry of config) args.push('-c', entry)
  if (threadId) args.push(threadId)
  args.push('-')
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('AKASHA_')),
  )
  env.AKASHA_TURN_URL = baseUrl
  env.AKASHA_TURN_TOKEN = token
  env.AKASHA_TURN_PROJECT = projectId
  const child = spawn('codex', args, {
    cwd: root,
    env,
    signal,
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  const exit = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(null))
    child.once('close', resolve)
  })
  child.stdin.on('error', () => undefined)
  child.stdin.end(prompt)
  child.stdout.setEncoding('utf8')
  let buffer = ''
  let received = 0
  let actualThread: string | undefined
  let reply = ''
  let complete = false
  let failed = false
  const consume = (line: string) => {
    const event = readEvent(line)
    switch (event?.type) {
      case 'thread.started':
        if (
          typeof event.thread_id !== 'string' ||
          !threadPattern.test(event.thread_id) ||
          (threadId && event.thread_id !== threadId) ||
          (actualThread && event.thread_id !== actualThread)
        )
          throw new Error('Codex 未确认授权线程')
        actualThread = event.thread_id
        onThread(actualThread)
        break
      case 'item.completed':
        if (event.item?.type === 'agent_message' && typeof event.item.text === 'string')
          reply = event.item.text.slice(0, 24_000)
        break
      case 'turn.completed':
        complete = true
        break
      case 'turn.failed':
        failed = true
        break
    }
  }
  try {
    for await (const text of child.stdout) {
      received += text.length
      if (received > 24_000_000) throw new Error('Codex 输出超出上限')
      buffer += text
      let end = buffer.indexOf('\n')
      while (end >= 0) {
        consume(buffer.slice(0, end))
        buffer = buffer.slice(end + 1)
        end = buffer.indexOf('\n')
      }
      if (buffer.length > 4_000_000) throw new Error('Codex 单条事件超出上限')
    }
    if (buffer) consume(buffer)
    if ((await exit) !== 0 || failed || !complete || !actualThread || !reply.trim())
      throw new Error('Codex 没有完成回复')
    return reply
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  }
}
