import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { type DaemonStatus, DaemonStatusSchema } from '@akasha/protocol'
import { AKASHA_VERSION } from './serve.js'
import {
  type DaemonStateFile,
  readDaemonState,
  removeDaemonState,
  resolveAkashaHome,
  upsertProjectRegistry,
} from './state.js'

export interface ProbeResult {
  state: DaemonStateFile
  status: DaemonStatus
  baseUrl: string
}

export async function probeDaemon(
  homeDir?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult | null> {
  const dir = resolveAkashaHome(homeDir)
  const state = readDaemonState(dir)
  if (!state) return null
  const baseUrl = `http://${state.host}:${state.port}`
  try {
    const res = await fetchImpl(`${baseUrl}/api/v1/daemon/status`, {
      headers: { authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return null
    const status = DaemonStatusSchema.parse(await res.json())
    return { state, status, baseUrl }
  } catch {
    return null
  }
}

export async function stopDaemon(
  homeDir?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ stopped: boolean; pid?: number }> {
  const dir = resolveAkashaHome(homeDir)
  const state = readDaemonState(dir)
  if (!state) return { stopped: false }

  const baseUrl = `http://${state.host}:${state.port}`
  try {
    await fetchImpl(`${baseUrl}/api/v1/daemon/shutdown`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${state.token}`,
      },
      body: '{}',
      signal: AbortSignal.timeout(2000),
    })
  } catch {
    // 进程可能已僵死或不可响应，尝试温和 SIGTERM
    if (state.pid !== process.pid) {
      try {
        process.kill(state.pid, 'SIGTERM')
      } catch {
        // 进程已不存在
      }
    }
  }

  // 等待端口释放与 daemon.json 清理（最多 3 秒）
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    const alive = await probeDaemon(dir, fetchImpl)
    if (!alive) break
    await new Promise((r) => setTimeout(r, 80))
  }
  removeDaemonState(dir)
  return { stopped: true, pid: state.pid }
}

export interface EnsureDaemonOptions {
  homeDir?: string
  projectDir?: string
  version?: string
  host?: string
  port?: number
  sandboxPort?: number
  dbPath?: string
  // 测试或内嵌场景可注入自定义启动器，默认以 detached 子进程启动 akasha serve
  launcher?: (args: {
    homeDir: string
    host: string
    port?: number
    sandboxPort?: number
    dbPath?: string
    version: string
  }) => Promise<void>
}

export async function ensureDaemon(options: EnsureDaemonOptions = {}): Promise<{
  state: DaemonStateFile
  baseUrl: string
  reused: boolean
  replaced: boolean
  projectId?: string
}> {
  const homeDir = resolveAkashaHome(options.homeDir)
  const version = options.version ?? AKASHA_VERSION
  const host = options.host ?? '127.0.0.1'

  let replaced = false
  let existing = await probeDaemon(homeDir)

  if (existing) {
    const versionMatches = existing.status.version === version
    const hostMatches = existing.state.host === host
    const portMatches = options.port === undefined || existing.state.port === options.port
    if (versionMatches && hostMatches && portMatches) {
      const projectId = options.projectDir
        ? await registerProjectWithDaemon(
            existing.baseUrl,
            existing.state.token,
            homeDir,
            options.projectDir,
          )
        : undefined
      return {
        state: existing.state,
        baseUrl: existing.baseUrl,
        reused: true,
        replaced: false,
        projectId,
      }
    }
    // 版本或全局配置发生变化：先平滑停止旧 Daemon，并继承原端口与原数据库路径，避免自定义 --db 丢失
    const prevPort = options.port ?? existing.state.port
    const prevSandboxPort = options.sandboxPort ?? existing.state.sandboxPort
    const prevDbPath = options.dbPath ?? existing.state.dbPath
    await stopDaemon(homeDir)
    replaced = true
    options = { ...options, port: prevPort, sandboxPort: prevSandboxPort, dbPath: prevDbPath }
    existing = null
  }

  if (options.launcher) {
    await options.launcher({
      homeDir,
      host,
      port: options.port,
      sandboxPort: options.sandboxPort,
      dbPath: options.dbPath,
      version,
    })
  } else {
    spawnDetachedServe({
      homeDir,
      host,
      port: options.port,
      sandboxPort: options.sandboxPort,
      dbPath: options.dbPath,
    })
  }

  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const ready = await probeDaemon(homeDir)
    if (ready) {
      const projectId = options.projectDir
        ? await registerProjectWithDaemon(
            ready.baseUrl,
            ready.state.token,
            homeDir,
            options.projectDir,
          )
        : undefined
      return {
        state: ready.state,
        baseUrl: ready.baseUrl,
        reused: false,
        replaced,
        projectId,
      }
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('拉起本地 Akasha Daemon 超时，请运行 akasha serve 检查端口与日志')
}

async function registerProjectWithDaemon(
  baseUrl: string,
  token: string,
  homeDir: string,
  projectDir: string,
): Promise<string> {
  const entry = upsertProjectRegistry(homeDir, projectDir)
  const res = await fetch(`${baseUrl}/api/v1/projects`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ rootPath: entry.rootPath, name: entry.name }),
  })
  if (!res.ok) {
    throw new Error(`向 Daemon 登记项目失败：HTTP ${res.status}`)
  }
  const data = (await res.json()) as { project: { id: string } }
  return data.project.id
}

function spawnDetachedServe(opts: {
  homeDir: string
  host: string
  port?: number
  sandboxPort?: number
  dbPath?: string
}): void {
  const cliPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../cli.js')
  const args = [cliPath, 'serve', '--host', opts.host]
  if (opts.port !== undefined) args.push('--port', String(opts.port))
  if (opts.sandboxPort !== undefined) args.push('--sandbox-port', String(opts.sandboxPort))
  if (opts.dbPath) args.push('--db', opts.dbPath)

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AKASHA_HOME: opts.homeDir },
  })
  child.unref()
}
