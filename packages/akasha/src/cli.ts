#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AsyncWakeupMonitor,
  fetchPromptContext,
  formatHarnessHookOutput,
  type HarnessId,
  type HarnessLifecycleEvent,
  reportHookActivity,
} from '@akasha/hooks'
import { runStdioMcpServer } from '@akasha/mcp'
import { ArtifactTypeSchema } from '@akasha/protocol'
import { CheckService, SpecRegistry } from '@akasha/server'
import { ensureDaemon, probeDaemon, stopDaemon } from './daemon/lifecycle.js'
import { AKASHA_VERSION, startAkashaDaemon } from './daemon/serve.js'
import { DEFAULT_SHELL_PORTS, resolveAkashaHome } from './daemon/state.js'
import { loginToHub, parseHubOrigin, readHubLogin, registerHubProject } from './hub/login.js'
import { installHarnessPlugin, runDoctor, SUPPORTED_HARNESSES } from './install/index.js'

export function formatCliBanner(): string {
  return `Akasha Terminal — Open-Source Live Web Artifacts for CLI Agents (v${AKASHA_VERSION})`
}

function parseFlags(args: string[]): {
  positional: string[]
  flags: Record<string, string | boolean>
} {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a) continue
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        const key = a.slice(2)
        const next = args[i + 1]
        if (next && !next.startsWith('--')) {
          flags[key] = next
          i++
        } else {
          flags[key] = true
        }
      }
    } else {
      positional.push(a)
    }
  }
  return { positional, flags }
}

function openBrowserUrl(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' })
  child.unref()
}

function parseHarnessFlag(raw: string | undefined): HarnessId | null {
  if (!raw) return null
  return (SUPPORTED_HARNESSES as readonly string[]).includes(raw) ? (raw as HarnessId) : null
}

const VALID_HOOK_EVENTS: readonly HarnessLifecycleEvent[] = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd',
  'UserPromptSubmit',
  'PreInvocation',
]

// 按项目 ID 或本地路径从 Daemon 登记表解析真实 projectId，找不到时回退原始入参或 null。
async function resolveProjectIdFromDaemon(
  baseUrl: string,
  token: string,
  projectHint: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/projects`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1200),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      projects?: Array<{ id: string; rootPath: string }>
    }
    const projects = data.projects ?? []
    const byId = projects.find((p) => p.id === projectHint)
    if (byId) return byId.id
    const resolved = path.resolve(projectHint)
    const byPath = projects.find((p) => path.resolve(p.rootPath) === resolved)
    if (byPath) return byPath.id
    // 允许当前工作目录位于已登记项目子目录中时向上匹配最近父项目
    const byAncestor = projects
      .filter((p) => {
        const root = path.resolve(p.rootPath)
        return resolved.startsWith(`${root}${path.sep}`)
      })
      .sort((a, b) => b.rootPath.length - a.rootPath.length)[0]
    return byAncestor?.id ?? null
  } catch {
    return null
  }
}

function printHelp(): void {
  console.log(`${formatCliBanner()}

用法：akasha <command> [options]

命令：
  serve    启动整机单例 Local Daemon（默认端口 24321，沙盒 24331）
  login    登录团队 Cloud Hub（akasha login --hub <origin>）
  mcp      启动 stdio MCP Server（本地目标自动拉起并复用 Daemon）
  status   查看运行中 Daemon 的状态与端口
  stop     平滑停止整机 Daemon
  logs     查看 Daemon 运行日志（支持 --project <id>）
  check    发布前静态校验（akasha check <file> --type <type>）
  spec     查看指定 Artifact 类型的写作规范与依赖白名单
  open     生成一次性浏览器登录链接并打开指定 Artifact（akasha open <id>）
  install  为 Claude Code / Antigravity / Codex / Cursor 安装插件、MCP 与 Skills
  doctor   检查 Node 版本、Daemon 连通性、候选端口冲突与插件安装完整性
  hook     多 Harness Hook 入口（akasha hook <prompt|activity|watch>）
`)
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return 0
  }
  if (command === '--version' || command === '-v') {
    console.log(AKASHA_VERSION)
    return 0
  }

  const { positional, flags } = parseFlags(rest)
  const strFlag = (k: string) => (typeof flags[k] === 'string' ? flags[k] : undefined)
  const numFlag = (k: string) => {
    const v = strFlag(k)
    return v !== undefined ? Number.parseInt(v, 10) : undefined
  }

  switch (command) {
    case 'serve': {
      const rawStorage = strFlag('storage')
      if (rawStorage && rawStorage !== 'sqlite' && rawStorage !== 'fs') {
        console.error(`不支持的存储模式 "${rawStorage}"（可选：sqlite | fs）`)
        return 2
      }
      const daemon = await startAkashaDaemon({
        host: strFlag('host'),
        port: numFlag('port'),
        sandboxPort: numFlag('sandbox-port'),
        dbPath: strFlag('db'),
        storageMode: rawStorage as 'sqlite' | 'fs' | undefined,
        artifactsDir: strFlag('artifacts-dir'),
        projectRoot: strFlag('project-dir') ?? (rawStorage === 'fs' ? process.cwd() : undefined),
        idleTimeoutSec: numFlag('idle-timeout'),
      })
      console.log(`Akasha Daemon v${daemon.state.version} 已启动`)
      console.log(`  Shell:   ${daemon.baseUrl}`)
      console.log(`  Sandbox: ${daemon.sandboxOrigin}`)
      const onSignal = () => {
        void daemon.close().then(() => process.exit(0))
      }
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)
      return 0
    }

    case 'login': {
      const origin = strFlag('hub') ?? positional[0] ?? process.env.AKASHA_HUB_URL
      if (!origin) {
        console.error('用法：akasha login --hub <origin>')
        return 2
      }
      await loginToHub(parseHubOrigin(origin), strFlag('home'))
      return 0
    }

    case 'mcp': {
      const hubInput = strFlag('hub') ?? process.env.AKASHA_HUB_URL
      const hubUrl = hubInput ? new URL(parseHubOrigin(hubInput)) : null
      const homeDir = resolveAkashaHome(strFlag('home'))
      const login = hubUrl ? readHubLogin(homeDir) : null
      const projectDir = strFlag('project') ?? process.cwd()
      let baseUrl: string
      let token = process.env.AKASHA_TOKEN
      let projectId: string | undefined

      let resolveConnection: (() => Promise<{ baseUrl: string; token?: string }>) | undefined

      const legacyLocal =
        hubUrl?.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(hubUrl.hostname) &&
        DEFAULT_SHELL_PORTS.some((port) => hubUrl.port === String(port)) &&
        login?.origin !== hubUrl.origin
      if (!hubUrl || legacyLocal) {
        const ensured = await ensureDaemon({ projectDir, homeDir })
        baseUrl = ensured.baseUrl
        token = ensured.state.token
        projectId = ensured.projectId
        resolveConnection = async () => {
          const refreshed = await ensureDaemon({ projectDir, homeDir })
          return { baseUrl: refreshed.baseUrl, token: refreshed.state.token }
        }
      } else {
        baseUrl = hubUrl.origin
        token ??= login?.origin === baseUrl ? login.token : undefined
        if (!token) {
          console.error(`请先运行 akasha login --hub ${baseUrl}`)
          return 2
        }
        projectId = await registerHubProject(baseUrl, token, projectDir)
      }

      await runStdioMcpServer({
        baseUrl,
        token,
        defaultProject: projectId,
        version: AKASHA_VERSION,
        resolveConnection,
      })
      return 0
    }

    case 'status': {
      const probed = await probeDaemon(strFlag('home'))
      if (!probed) {
        console.log('Akasha Daemon 未运行')
        return 1
      }
      console.log(JSON.stringify({ baseUrl: probed.baseUrl, ...probed.status }, null, 2))
      return 0
    }

    case 'stop': {
      const res = await stopDaemon(strFlag('home'))
      console.log(res.stopped ? `已停止 Akasha Daemon（pid=${res.pid}）` : 'Akasha Daemon 未运行')
      return 0
    }

    case 'logs': {
      const probed = await probeDaemon(strFlag('home'))
      if (!probed) {
        console.error('Akasha Daemon 未运行')
        return 1
      }
      const qs = new URLSearchParams()
      if (strFlag('project')) qs.set('projectId', strFlag('project') ?? '')
      if (strFlag('limit')) qs.set('limit', strFlag('limit') ?? '')
      const res = await fetch(`${probed.baseUrl}/api/v1/daemon/logs?${qs.toString()}`, {
        headers: { authorization: `Bearer ${probed.state.token}` },
      })
      const data = (await res.json()) as {
        entries: Array<{ timestamp: string; level: string; projectId?: string; message: string }>
      }
      for (const e of data.entries) {
        console.log(
          `${e.timestamp} [${e.level}]${e.projectId ? ` [${e.projectId}]` : ''} ${e.message}`,
        )
      }
      return 0
    }

    case 'check': {
      const file = positional[0]
      const rawType = strFlag('type')
      if (!file || !rawType) {
        console.error('用法：akasha check <file> --type <artifact-type>')
        return 2
      }
      const parsedType = ArtifactTypeSchema.safeParse(rawType)
      if (!parsedType.success) {
        console.error(`不支持的 Artifact 类型：${rawType}`)
        return 2
      }
      const source = fs.readFileSync(path.resolve(file), 'utf8')
      const checker = new CheckService(new SpecRegistry())
      const result = checker.check({ type: parsedType.data, source })
      console.log(JSON.stringify(result, null, 2))
      return result.ok ? 0 : 3
    }

    case 'spec': {
      const rawType = positional[0]
      const parsedType = ArtifactTypeSchema.safeParse(rawType)
      if (!parsedType.success) {
        console.error('用法：akasha spec <artifact-type>')
        return 2
      }
      const spec = new SpecRegistry().getSpec(parsedType.data)
      console.log(JSON.stringify(spec, null, 2))
      return 0
    }

    case 'open': {
      const id = positional[0]
      const ensured = await ensureDaemon({ projectDir: process.cwd(), homeDir: strFlag('home') })
      const next = id ? `/a/${encodeURIComponent(id)}` : '/'
      const res = await fetch(`${ensured.baseUrl}/api/v1/auth/otc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ensured.state.token}`,
        },
        body: JSON.stringify({ next }),
      })
      if (!res.ok) {
        console.error(`申请一次性访问链接失败：HTTP ${res.status}`)
        return 1
      }
      const { openPath } = (await res.json()) as { openPath: string }
      const url = `${ensured.baseUrl}${openPath}`
      console.log(url)
      if (!flags['no-browser']) {
        openBrowserUrl(url)
      }
      return 0
    }

    case 'install': {
      const rawHarness = strFlag('harness') ?? positional[0]
      const harness = parseHarnessFlag(rawHarness)
      if (!harness) {
        console.error(
          `用法：akasha install --harness <${SUPPORTED_HARNESSES.join('|')}> [--dir <path>]`,
        )
        return 2
      }
      const res = installHarnessPlugin({
        harness,
        targetDir: strFlag('dir'),
      })
      console.log(JSON.stringify(res, null, 2))
      return 0
    }

    case 'doctor': {
      const rawHarness = strFlag('harness')
      const harness = rawHarness ? parseHarnessFlag(rawHarness) : undefined
      if (rawHarness && !harness) {
        console.error(`不支持的客户端：${rawHarness}（可选：${SUPPORTED_HARNESSES.join(', ')}）`)
        return 2
      }
      const report = await runDoctor({
        akashaHome: strFlag('home'),
        harness: harness ?? undefined,
        targetDir: strFlag('dir'),
      })
      console.log(JSON.stringify(report, null, 2))
      return report.ok ? 0 : 1
    }

    case 'hook': {
      const sub = positional[0]
      const akashaHome = strFlag('home')
      const projectHint = strFlag('project') ?? process.cwd()

      if (sub === 'prompt') {
        const harness = parseHarnessFlag(strFlag('harness') ?? 'claude-code')
        if (!harness) {
          console.error(`不支持的客户端：${strFlag('harness')}`)
          return 2
        }
        const probed = await probeDaemon(akashaHome)
        if (!probed) {
          console.log('{}')
          return 0
        }
        const projectId = await resolveProjectIdFromDaemon(
          probed.baseUrl,
          probed.state.token,
          projectHint,
        )
        if (!projectId) {
          console.log('{}')
          return 0
        }
        const ctx = await fetchPromptContext({
          baseUrl: probed.baseUrl,
          token: probed.state.token,
          projectId,
          untrustedExternal: Boolean(flags.untrusted),
          maxChars: numFlag('max-chars'),
        })
        console.log(JSON.stringify(formatHarnessHookOutput(harness, ctx)))
        return 0
      }

      if (sub === 'activity') {
        const rawEvent = strFlag('event') ?? 'PreToolUse'
        if (!(VALID_HOOK_EVENTS as readonly string[]).includes(rawEvent)) {
          console.error(`不支持的 Hook 生命周期事件：${rawEvent}`)
          return 2
        }
        const probed = await probeDaemon(akashaHome)
        if (!probed) return 0
        const projectId = await resolveProjectIdFromDaemon(
          probed.baseUrl,
          probed.state.token,
          projectHint,
        )
        if (!projectId) return 0
        await reportHookActivity({
          baseUrl: probed.baseUrl,
          token: probed.state.token,
          projectId,
          artifactId: strFlag('artifact'),
          event: rawEvent as HarnessLifecycleEvent,
          summary: strFlag('summary'),
        })
        return 0
      }

      if (sub === 'watch') {
        const probed = await probeDaemon(akashaHome)
        if (!probed) {
          console.error('Akasha Daemon 未运行')
          return 1
        }
        const projectId = await resolveProjectIdFromDaemon(
          probed.baseUrl,
          probed.state.token,
          projectHint,
        )
        if (!projectId) {
          console.error(`未在 Daemon 中找到项目 "${projectHint}"`)
          return 1
        }
        const wsUrl = `ws://${probed.state.host}:${probed.state.port}/api/v1/ws`
        const once = Boolean(flags.once)
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            process.off('SIGINT', stop)
            process.off('SIGTERM', stop)
          }
          const stop = () => {
            cleanup()
            monitor.stop()
            resolve()
          }
          const monitor = new AsyncWakeupMonitor({
            wsUrl,
            projectId,
            artifactId: strFlag('artifact'),
            debounceMs: numFlag('debounce') ?? 250,
            onWakeup: (batch) => {
              console.log(JSON.stringify(batch))
              if (once) {
                stop()
              }
            },
          })
          process.once('SIGINT', stop)
          process.once('SIGTERM', stop)
          monitor.start()
        })
        return 0
      }

      console.error('用法：akasha hook <prompt|activity|watch> [options]')
      return 2
    }

    default:
      console.error(`未知命令：${command}`)
      printHelp()
      return 2
  }
}

const isEntry =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isEntry) {
  runCli(process.argv.slice(2))
    .then((code) => {
      if (code !== 0) process.exit(code)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    })
}
