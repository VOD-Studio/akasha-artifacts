#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runStdioMcpServer } from '@akasha/mcp'
import { ArtifactTypeSchema } from '@akasha/protocol'
import { CheckService, SpecRegistry } from '@akasha/server'
import { ensureDaemon, probeDaemon, stopDaemon } from './daemon/lifecycle.js'
import { AKASHA_VERSION, startAkashaDaemon } from './daemon/serve.js'

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

function printHelp(): void {
  console.log(`${formatCliBanner()}

用法：akasha <command> [options]

命令：
  serve    启动整机单例 Local Daemon（默认端口 24321，沙盒 24331）
  mcp      启动 stdio MCP Server（本地目标自动拉起并复用 Daemon）
  status   查看运行中 Daemon 的状态与端口
  stop     平滑停止整机 Daemon
  logs     查看 Daemon 运行日志（支持 --project <id>）
  check    发布前静态校验（akasha check <file> --type <type>）
  spec     查看指定 Artifact 类型的写作规范与依赖白名单
  open     生成一次性浏览器登录链接并打开指定 Artifact（akasha open <id>）
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
      const daemon = await startAkashaDaemon({
        host: strFlag('host'),
        port: numFlag('port'),
        sandboxPort: numFlag('sandbox-port'),
        dbPath: strFlag('db'),
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

    case 'mcp': {
      const hubUrl = strFlag('hub') ?? process.env.AKASHA_HUB_URL
      const projectDir = strFlag('project') ?? process.cwd()
      let baseUrl: string
      let token = process.env.AKASHA_TOKEN
      let projectId: string | undefined

      if (!hubUrl || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(hubUrl)) {
        const ensured = await ensureDaemon({ projectDir })
        baseUrl = ensured.baseUrl
        token = ensured.state.token
        projectId = ensured.projectId
      } else {
        baseUrl = hubUrl
      }

      await runStdioMcpServer({
        baseUrl,
        token,
        defaultProject: projectId,
        version: AKASHA_VERSION,
      })
      return 0
    }

    case 'status': {
      const probed = await probeDaemon()
      if (!probed) {
        console.log('Akasha Daemon 未运行')
        return 1
      }
      console.log(JSON.stringify({ baseUrl: probed.baseUrl, ...probed.status }, null, 2))
      return 0
    }

    case 'stop': {
      const res = await stopDaemon()
      console.log(res.stopped ? `已停止 Akasha Daemon（pid=${res.pid}）` : 'Akasha Daemon 未运行')
      return 0
    }

    case 'logs': {
      const probed = await probeDaemon()
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
      const ensured = await ensureDaemon({ projectDir: process.cwd() })
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
