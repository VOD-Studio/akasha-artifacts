import { execFile, spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
// view_image 和 apply_patch 等内建工具仍受下方的文件权限配置约束。
const disabledFeatures = [
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'hooks',
  'apps',
  'plugins',
  'tool_suggest',
  'multi_agent',
  'multi_agent_v2',
  'code_mode',
  'browser_use',
  'browser_use_external',
  'in_app_browser',
  'computer_use',
  'image_generation',
  'imagegenext',
  'workspace_dependencies',
  'request_permissions_tool',
  'memories',
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
    check: () =>
      new Promise((resolve, reject) => {
        execFile(
          'codex',
          ['login', 'status'],
          { cwd: tmpdir(), timeout: 5000, windowsHide: true },
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
  const { threadId, signal } = request
  if (threadId && !threadPattern.test(threadId)) throw new Error('无效的 Codex 线程')
  signal.throwIfAborted()
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'akasha-turn-'))
  try {
    const images: string[] = []
    for (const { bytes, extension } of request.images ?? []) {
      const name = `image-${images.length + 1}.${extension === 'jpg' ? 'jpg' : 'png'}`
      await writeFile(join(cwd, name), bytes, { flag: 'wx', mode: 0o400, signal })
      images.push(name)
    }
    return await executeTurn(akashaEntrypoint, request, cwd, images)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

async function executeTurn(
  akashaEntrypoint: string,
  request: AgentRunnerLaunch,
  cwd: string,
  images: readonly string[],
) {
  const { threadId, prompt, token, baseUrl, projectId, signal, onThread } = request
  const args = [
    'exec',
    ...(threadId ? ['resume'] : []),
    '--json',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
  ]
  const tools = request.requestedTweaksOnly
    ? ['artifact_read_handoff', 'artifact_apply_requested_tweaks']
    : scopedTools
  const config = [
    'approval_policy="never"',
    // Codex 的 read-only 沙盒默认可以读全盘。命名配置从无权限开始，只读本轮临时目录。
    'default_permissions="akasha"',
    `permissions.akasha.filesystem={${JSON.stringify(cwd)}="read"}`,
    'permissions.akasha.network.enabled=false',
    // 即使系统临时目录位于某个仓库内，也不向上发现该仓库的 Codex 配置。
    'project_root_markers=[]',
    'project_doc_max_bytes=0',
    'skills.include_instructions=false',
    'skills.bundled.enabled=false',
    'web_search="disabled"',
    ...disabledFeatures.map((feature) => `features.${feature}=false`),
    'shell_environment_policy.inherit="none"',
    `mcp_servers.akasha.command=${JSON.stringify(process.execPath)}`,
    'mcp_servers.akasha.required=true',
    `mcp_servers.akasha.args=${JSON.stringify([akashaEntrypoint, 'mcp', '--agent-turn'])}`,
    `mcp_servers.akasha.env_vars=${JSON.stringify(scopedEnv)}`,
    `mcp_servers.akasha.enabled_tools=${JSON.stringify(tools)}`,
    ...tools.map((tool) => `mcp_servers.akasha.tools.${tool}.approval_mode="approve"`),
  ]
  for (const entry of config) args.push('-c', entry)
  for (const image of images) args.push('--image', image)
  args.push('--')
  if (threadId) args.push(threadId)
  args.push('-')
  // 保留 CLI 查找本机登录和运行所需的环境，不传项目路径、Daemon 凭据等无关变量。
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'CODEX_HOME',
    'XDG_RUNTIME_DIR',
    'XDG_DATA_HOME',
    'DBUS_SESSION_BUS_ADDRESS',
    'USERPROFILE',
    'SystemRoot',
    'LOCALAPPDATA',
    'APPDATA',
    'TMPDIR',
    'TMP',
    'TEMP',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env.AKASHA_TURN_URL = baseUrl
  env.AKASHA_TURN_TOKEN = token
  env.AKASHA_TURN_PROJECT = projectId
  const child = spawn('codex', args, {
    cwd,
    env,
    signal,
    killSignal: 'SIGKILL',
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  const exit = new Promise<number | null>((resolve) => {
    // error（尤其是中止）可能早于进程关闭；须等 close 才能删除仍在使用的附件。
    child.once('error', () => undefined)
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
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exit
  }
}
