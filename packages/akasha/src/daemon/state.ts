import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/**
 * 外壳与服务端的候选端口，按顺序取第一个空闲的。
 *
 * @remarks 固定在高端口段，让浏览器书签跨会话有效；可用 `AKASHA_PORTS` 覆盖。
 */
export const DEFAULT_SHELL_PORTS = [24321, 24322, 24323] as const

/**
 * 沙盒静态服务的候选端口。
 *
 * @remarks 与外壳端口段分开，保证沙盒是不同的 origin；可用 `AKASHA_SANDBOX_PORTS` 覆盖。
 */
export const DEFAULT_SANDBOX_PORTS = [24331, 24332, 24333] as const

/**
 * 写在 `~/.akasha/daemon.json` 里的 Daemon 运行信息，是 CLI、Hook 与外壳定位本机 Daemon 的依据。
 *
 * @remarks 含访问令牌，文件权限为 0600。
 */
export interface DaemonStateFile {
  /** 收到停止请求或升级替换时据此发信号。 */
  pid: number
  /** 监听地址，缺省 127.0.0.1。 */
  host: string
  /** 实际绑定的外壳与服务端端口。 */
  port: number
  /** 实际绑定的沙盒端口。 */
  sandboxPort: number
  /** 写接口的 Bearer 令牌，每次启动随机生成。 */
  token: string
  /** 启动时的包版本；与当前 CLI 版本不同时触发平滑替换。 */
  version: string
  /** 启动时间，ISO 8601。 */
  startedAt: string
  /** SQLite 库路径；替换旧 Daemon 时沿用它。 */
  dbPath: string
}

/** 本机项目登记表 `~/.akasha/projects.json` 里的一条。 */
export interface ProjectRegistryEntry {
  /** 规范化后的绝对路径，是登记表的唯一键。 */
  rootPath: string
  name: string
  lastActiveAt: string
}

/** 解析 Akasha 的 home 目录：入参优先，其次 `AKASHA_HOME` 环境变量，最后 `~/.akasha`。 */
export function resolveAkashaHome(override?: string): string {
  return path.resolve(override ?? process.env.AKASHA_HOME ?? path.join(os.homedir(), '.akasha'))
}

/** 解析逗号分隔的端口列表；非法项被丢弃，全部非法时回退到 `fallback`。 */
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

export function daemonLockPath(homeDir: string): string {
  return path.join(homeDir, 'daemon.lock')
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 获取整机单例锁，防止多个 Daemon 争用同一个 SQLite 库。
 *
 * @returns 释放函数；只删除自己写入的锁文件，重复调用无效果。
 *
 * @throws {Error} 另一个存活进程已持锁，或锁文件正在写入、已损坏。
 * 锁的持有者已经退出时，清掉过期锁后重试一次。
 */
export function acquireDaemonLock(homeDir: string): { release: () => void } {
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 })
  const lockFile = daemonLockPath(homeDir)
  const ownerId = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lockFile, 'wx', 0o600)
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, ownerId, acquiredAt: new Date().toISOString() }),
      )
      fs.closeSync(fd)
      let released = false
      return {
        release: () => {
          if (released) return
          released = true
          try {
            const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { ownerId?: string }
            if (raw.ownerId === ownerId) {
              fs.rmSync(lockFile, { force: true })
            }
          } catch {
            // 锁文件可能已被清理
          }
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err
      }
      // 检测是否为已退出进程残留的过期锁
      try {
        const raw = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as { pid?: number }
        if (typeof raw.pid === 'number' && !isPidAlive(raw.pid)) {
          fs.rmSync(lockFile, { force: true })
          continue
        }
        throw new Error(
          `Akasha Daemon 已在运行（pid=${raw.pid ?? 'unknown'}），同一 home 目录仅允许运行一个单例`,
        )
      } catch (readErr) {
        if (readErr instanceof Error && readErr.message.includes('已在运行')) {
          throw readErr
        }
        // 锁文件正在写入或已损坏，抛出冲突错误交由调用方探测复用
        throw new Error('Akasha Daemon 正在启动或已在运行，请勿重复启动')
      }
    }
  }
  throw new Error('获取 Akasha Daemon 单例锁失败')
}

export function projectsRegistryPath(homeDir: string): string {
  return path.join(homeDir, 'projects.json')
}

/** 读取 Daemon 状态；文件不存在、不是合法 JSON 或必填字段缺失时返回 `null`。 */
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

/** 原子写入 `daemon.json`，并把权限收紧为 0600，避免同机其他用户读到访问令牌。 */
export function writeDaemonState(homeDir: string, state: DaemonStateFile): void {
  fs.mkdirSync(homeDir, { recursive: true, mode: 0o700 })
  const file = daemonStatePath(homeDir)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

/** 删除 `daemon.json`；给出 `expectedPid` 且文件记录的是别的进程时不删除。 */
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

/** 登记或刷新一个项目，并把登记表按最近活跃时间降序写回。 */
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

/**
 * 按顺序在候选端口里找第一个可绑定的。
 *
 * @returns 选中的端口；候选里有 `0` 时直接返回 `0`，交给系统分配。
 * @throws {Error} 候选端口全部被占用。
 */
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
