import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_SHELL_PORTS = [24321, 24322, 24323] as const
export const DEFAULT_SANDBOX_PORTS = [24331, 24332, 24333] as const

export interface DaemonStateFile {
  pid: number
  host: string
  port: number
  sandboxPort: number
  token: string
  version: string
  startedAt: string
  dbPath: string
}

export interface ProjectRegistryEntry {
  rootPath: string
  name: string
  lastActiveAt: string
}

export function resolveAkashaHome(override?: string): string {
  return path.resolve(override ?? process.env.AKASHA_HOME ?? path.join(os.homedir(), '.akasha'))
}

export function parsePortList(envValue: string | undefined, fallback: readonly number[]): number[] {
  if (!envValue) return [...fallback]
  const parsed = envValue
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 65535)
  return parsed.length > 0 ? parsed : [...fallback]
}

export function daemonStatePath(homeDir: string): string {
  return path.join(homeDir, 'daemon.json')
}

export function projectsRegistryPath(homeDir: string): string {
  return path.join(homeDir, 'projects.json')
}

export function readDaemonState(homeDir: string): DaemonStateFile | null {
  const file = daemonStatePath(homeDir)
  if (!fs.existsSync(file)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DaemonStateFile>
    if (
      typeof raw.pid === 'number' &&
      typeof raw.host === 'string' &&
      typeof raw.port === 'number' &&
      typeof raw.sandboxPort === 'number' &&
      typeof raw.token === 'string' &&
      typeof raw.version === 'string'
    ) {
      return raw as DaemonStateFile
    }
    return null
  } catch {
    return null
  }
}

// 原子写入 daemon.json 并限制权限为 0600，避免同机其它用户读取访问令牌
export function writeDaemonState(homeDir: string, state: DaemonStateFile): void {
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 })
  const file = daemonStatePath(homeDir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

export function removeDaemonState(homeDir: string, expectedPid?: number): void {
  const file = daemonStatePath(homeDir)
  if (!fs.existsSync(file)) return
  if (expectedPid !== undefined) {
    const current = readDaemonState(homeDir)
    if (current && current.pid !== expectedPid) return
  }
  fs.rmSync(file, { force: true })
}

export function readProjectsRegistry(homeDir: string): ProjectRegistryEntry[] {
  const file = projectsRegistryPath(homeDir)
  if (!fs.existsSync(file)) return []
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    return Array.isArray(raw) ? (raw as ProjectRegistryEntry[]) : []
  } catch {
    return []
  }
}

export function upsertProjectRegistry(
  homeDir: string,
  rootPath: string,
  name?: string,
): ProjectRegistryEntry {
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 })
  const resolvedRoot = path.resolve(rootPath)
  const resolvedName = name?.trim() || path.basename(resolvedRoot) || resolvedRoot
  const now = new Date().toISOString()
  const list = readProjectsRegistry(homeDir)
  const idx = list.findIndex((p) => p.rootPath === resolvedRoot)
  const entry: ProjectRegistryEntry = {
    rootPath: resolvedRoot,
    name: resolvedName,
    lastActiveAt: now,
  }
  if (idx === -1) list.unshift(entry)
  else list[idx] = entry
  list.sort((a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt))
  fs.writeFileSync(projectsRegistryPath(homeDir), `${JSON.stringify(list, null, 2)}\n`)
  return entry
}

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', () => resolve(false))
    srv.listen(port, host, () => {
      srv.close(() => resolve(true))
    })
  })
}

export async function findAvailablePort(
  candidates: readonly number[],
  host: string,
): Promise<number> {
  for (const port of candidates) {
    if (port === 0) return 0
    if (await isPortAvailable(port, host)) {
      return port
    }
  }
  throw new Error(`候选端口均被占用：${candidates.join(', ')}`)
}
