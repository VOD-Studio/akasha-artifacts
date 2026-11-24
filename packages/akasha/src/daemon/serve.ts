import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PublicIdSchema } from '@akasha/protocol'
import { buildLoopbackOrigins, startNodeServer } from '@akasha/server'
import { createCodexRunner } from '../agent/codex.js'
import { readHubLogin } from '../hub/login.js'
import { startSandboxServer } from './sandbox-server.js'
import {
  acquireDaemonLock,
  type DaemonStateFile,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SHELL_PORTS,
  findAvailablePort,
  parsePortList,
  removeDaemonState,
  resolveAkashaHome,
  writeDaemonState,
} from './state.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

// 从同级 package.json 动态读取当前发布版本，保证发版升级后 Daemon 与 CLI 版本号自动同步。
function readPackageVersion(): string {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    if (typeof raw.version === 'string' && raw.version.length > 0) {
      return raw.version
    }
  } catch {
    // 读取失败时回退默认版本号
  }
  return '0.1.0'
}

/** 当前包版本；读不到 `package.json` 时为 0.1.0。 */
export const AKASHA_VERSION = readPackageVersion()

export interface StartDaemonOptions {
  // Akasha home 目录
  homeDir?: string
  host?: string
  // 指定后只尝试这一个端口；省略时按候选端口段取第一个空闲的
  port?: number
  // 同 `port`，作用于沙盒服务
  sandboxPort?: number
  // SQLite 库路径，缺省 <homeDir>/akasha.db
  dbPath?: string
  // fs 时用项目内 .artifacts/ 目录，否则用 SQLite
  storageMode?: 'sqlite' | 'fs'
  // 仅 fs 模式使用
  artifactsDir?: string
  // 仅 fs 模式使用；缺省为当前工作目录
  projectRoot?: string
  // 对外报告的版本，缺省取当前包版本
  version?: string
  // 外壳静态产物目录；缺省自动定位，找不到时返回占位页
  webDir?: string
  // 沙盒静态产物目录；缺省自动定位，找不到时返回占位页
  sandboxDir?: string
  // 仅开发入口传入：页面由 Vite 托管，同一次开发会话内复用登录令牌。
  development?: {
    workbenchOrigin: string
    sandboxOrigin: string
    sessionToken: string
  }
  // 没有实时连接且持续空闲超过该秒数时自动退出；省略或 0 表示常驻
  idleTimeoutSec?: number
}

// 依次在 npm 包的 assets 目录与仓库工作区里找带 index.html 的产物目录
function defaultAssetDir(relFromWorkspace: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../assets', path.basename(path.dirname(relFromWorkspace))),
    path.resolve(here, '../../../..', relFromWorkspace),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir
    }
  }
  return undefined
}

/**
 * 启动整机单例 Daemon；沙盒默认由独立静态服务托管，开发时由 Vite 接管。
 *
 * @remarks 先取单例锁再绑定端口，启动失败时释放已占用的端口与锁。就绪后写出 `daemon.json`。
 * 返回的 `close` 会清掉状态文件、关闭两个服务并释放锁。
 * @throws {Error} 已有 Daemon 在运行，或候选端口全部被占用。
 */
export async function startAkashaDaemon(options: StartDaemonOptions = {}) {
  const { development } = options
  const homeDir = resolveAkashaHome(options.homeDir)
  const host = options.host ?? '127.0.0.1'
  const version = options.version ?? AKASHA_VERSION
  const dbPath = options.dbPath ?? path.join(homeDir, 'akasha.db')

  const lock = acquireDaemonLock(homeDir)

  let nodeSrv: Awaited<ReturnType<typeof startNodeServer>> | undefined
  let sandboxSrv: Awaited<ReturnType<typeof startSandboxServer>> | undefined
  let sandboxOrigin: string
  let closeAll: (() => Promise<void>) | undefined

  try {
    const shellCandidates =
      options.port !== undefined
        ? [options.port]
        : parsePortList(process.env.AKASHA_PORTS, DEFAULT_SHELL_PORTS)
    const chosenSandboxPort = development
      ? Number(new URL(development.sandboxOrigin).port)
      : await findAvailablePort(
          options.sandboxPort !== undefined
            ? [options.sandboxPort]
            : parsePortList(process.env.AKASHA_SANDBOX_PORTS, DEFAULT_SANDBOX_PORTS),
          host,
        )

    const chosenShellPort = await findAvailablePort(shellCandidates, host)

    nodeSrv = await startNodeServer({
      host,
      port: chosenShellPort,
      sandboxPort: chosenSandboxPort,
      dbPath,
      storageMode: options.storageMode,
      artifactsDir: options.artifactsDir,
      fsProjectRoot:
        options.projectRoot ?? (options.storageMode === 'fs' ? process.cwd() : undefined),
      version,
      security: development ? { token: development.sessionToken } : undefined,
      agentRunner: createCodexRunner(fileURLToPath(new URL('../cli.js', import.meta.url))),
      agentHost: host === '::1' ? '[::1]' : host === 'localhost' ? host : '127.0.0.1',
      onShutdown: () => {
        void closeAll?.()
      },
    })

    if (development) {
      sandboxOrigin = development.sandboxOrigin
    } else {
      const sandboxDir = options.sandboxDir ?? defaultAssetDir('apps/sandbox/dist')
      sandboxSrv = await startSandboxServer({
        host,
        port: chosenSandboxPort,
        shellOrigins: buildLoopbackOrigins(nodeSrv.port),
        sandboxDir,
      })
      nodeSrv.daemonState.sandboxPort = sandboxSrv.port
      sandboxOrigin = sandboxSrv.origin
    }
  } catch (err) {
    await sandboxSrv?.close()
    await nodeSrv?.close()
    lock.release()
    throw err
  }

  const activeNodeSrv = nodeSrv

  // 仅向本机已登录的 Hub 公开命中与否，不返回制品数据、Cookie 或 Daemon 令牌。
  activeNodeSrv.app.on(['GET', 'OPTIONS'], '/api/v1/local-artifact/:id', async (c) => {
    const origin = c.req.header('Origin')
    if (!origin || readHubLogin(homeDir)?.origin !== origin) return c.body(null, 404)
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204, headers)
    const id = PublicIdSchema.safeParse(c.req.param('id'))
    if (!id.success || !(await activeNodeSrv.repositories.artifacts.findByPublicId(id.data))) {
      return c.body(null, 404, headers)
    }
    const version = c.req.query('version')
    if (version !== undefined) {
      if (
        !/^[1-9]\d*$/.test(version) ||
        !(await activeNodeSrv.repositories.artifacts.getVersion(id.data, Number(version)))
      ) {
        return c.body(null, 404, headers)
      }
    }
    return c.body(null, 204, headers)
  })

  // 挂载外壳 SPA 静态产物（排除 /api/* 与 /auth/*）
  const webDir = development ? undefined : (options.webDir ?? defaultAssetDir('apps/web/dist'))
  const resolvedWebDir = webDir ? path.resolve(webDir) : undefined
  activeNodeSrv.app.get('*', (c) => {
    const reqPath = c.req.path
    if (reqPath.startsWith('/api/') || reqPath.startsWith('/auth/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: `路径 ${reqPath} 不存在` } }, 404)
    }
    if (development) {
      // CLI 和登录仍走 Daemon；页面跳转到唯一的开发入口，保留原路径和查询参数。
      const { pathname, search } = new URL(c.req.url)
      c.header('Cache-Control', 'no-store')
      return c.redirect(`${development.workbenchOrigin}${pathname}${search}`)
    }
    if (resolvedWebDir && fs.existsSync(resolvedWebDir)) {
      const indexHtml = path.join(resolvedWebDir, 'index.html')
      const serveIndex = () => {
        const html = fs
          .readFileSync(indexHtml, 'utf8')
          .replace(
            '</head>',
            `<script>window.__AKASHA_CONFIG__=${JSON.stringify({ sandboxOrigin })};</script></head>`,
          )
        return c.html(html, 200, {
          'Cache-Control': 'no-store',
          'Content-Security-Policy': `frame-src ${sandboxOrigin}`,
        })
      }

      if (reqPath === '/' || reqPath === '/index.html') {
        if (fs.existsSync(indexHtml)) {
          return serveIndex()
        }
      } else {
        const rel = reqPath.replace(/^\/+/, '')
        const target = path.resolve(resolvedWebDir, rel)
        const inside =
          target === resolvedWebDir || target.startsWith(`${resolvedWebDir}${path.sep}`)
        if (inside && fs.existsSync(target) && fs.statSync(target).isFile()) {
          const ext = path.extname(target).toLowerCase()
          return c.body(fs.readFileSync(target), 200, {
            'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
          })
        }
        if (fs.existsSync(indexHtml)) {
          return serveIndex()
        }
      }
    }
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8"><title>Akasha Terminal</title></head><body><h1>Akasha Terminal v${version}</h1><p>Daemon running on ${activeNodeSrv.baseUrl} · Sandbox ${sandboxOrigin}</p></body></html>`,
    )
  })

  const state: DaemonStateFile = {
    pid: process.pid,
    host,
    port: activeNodeSrv.port,
    sandboxPort: activeNodeSrv.daemonState.sandboxPort,
    token: activeNodeSrv.token,
    version,
    startedAt: activeNodeSrv.daemonState.startedAt,
    dbPath,
  }
  writeDaemonState(homeDir, state)

  let closed = false
  let idleTimer: ReturnType<typeof setInterval> | undefined
  let lastActivityMs = Date.now()

  // 空闲判定只看实时连接数：有连接就视为活跃
  if (options.idleTimeoutSec && options.idleTimeoutSec > 0) {
    const idleMs = options.idleTimeoutSec * 1000
    idleTimer = setInterval(
      () => {
        if (activeNodeSrv.realtime.getActiveConnections() > 0) {
          lastActivityMs = Date.now()
          return
        }
        if (Date.now() - lastActivityMs >= idleMs) {
          void closeAll?.()
        }
      },
      Math.min(5000, Math.max(500, Math.floor(idleMs / 4))),
    )
    idleTimer.unref()
  }

  closeAll = async () => {
    if (closed) return
    closed = true
    if (idleTimer) clearInterval(idleTimer)
    removeDaemonState(homeDir, process.pid)
    try {
      await Promise.all([activeNodeSrv.close(), sandboxSrv?.close()])
    } finally {
      lock.release()
    }
  }

  return {
    state,
    baseUrl: activeNodeSrv.baseUrl,
    wsUrl: activeNodeSrv.wsUrl,
    sandboxOrigin,
    token: activeNodeSrv.token,
    nodeSrv: activeNodeSrv,
    sandboxSrv,
    close: closeAll,
  }
}
