import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLoopbackOrigins, startNodeServer } from '@akasha/server'
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

export const AKASHA_VERSION = '0.1.0'

export interface StartDaemonOptions {
  homeDir?: string
  host?: string
  port?: number
  sandboxPort?: number
  dbPath?: string
  version?: string
  webDir?: string
  sandboxDir?: string
  idleTimeoutSec?: number
}

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

// 启动整机单例 Daemon：先抢占原子单例锁，再绑定外壳主服务（固定高端口段）与独立 Origin 沙盒服务。
export async function startAkashaDaemon(options: StartDaemonOptions = {}) {
  const homeDir = resolveAkashaHome(options.homeDir)
  const host = options.host ?? '127.0.0.1'
  const version = options.version ?? AKASHA_VERSION
  const dbPath = options.dbPath ?? path.join(homeDir, 'akasha.db')

  const lock = acquireDaemonLock(homeDir)

  let nodeSrv: Awaited<ReturnType<typeof startNodeServer>> | undefined
  let sandboxSrv: Awaited<ReturnType<typeof startSandboxServer>> | undefined
  let closeAll: (() => Promise<void>) | undefined

  try {
    const shellCandidates =
      options.port !== undefined
        ? [options.port]
        : parsePortList(process.env.AKASHA_PORTS, DEFAULT_SHELL_PORTS)
    const sandboxCandidates =
      options.sandboxPort !== undefined
        ? [options.sandboxPort]
        : parsePortList(process.env.AKASHA_SANDBOX_PORTS, DEFAULT_SANDBOX_PORTS)

    const chosenShellPort = await findAvailablePort(shellCandidates, host)
    const chosenSandboxPort = await findAvailablePort(sandboxCandidates, host)

    nodeSrv = await startNodeServer({
      host,
      port: chosenShellPort,
      sandboxPort: chosenSandboxPort,
      dbPath,
      version,
      onShutdown: () => {
        void closeAll?.()
      },
    })

    const sandboxDir = options.sandboxDir ?? defaultAssetDir('apps/sandbox/dist')
    sandboxSrv = await startSandboxServer({
      host,
      port: chosenSandboxPort,
      shellOrigins: buildLoopbackOrigins(nodeSrv.port),
      sandboxDir,
    })
    nodeSrv.daemonState.sandboxPort = sandboxSrv.port
  } catch (err) {
    await sandboxSrv?.close()
    await nodeSrv?.close()
    lock.release()
    throw err
  }

  const activeNodeSrv = nodeSrv
  const activeSandboxSrv = sandboxSrv

  // 挂载外壳 SPA 静态产物（排除 /api/* 与 /auth/*）
  const webDir = options.webDir ?? defaultAssetDir('apps/web/dist')
  const resolvedWebDir = webDir ? path.resolve(webDir) : undefined
  activeNodeSrv.app.get('*', (c) => {
    const reqPath = c.req.path
    if (reqPath.startsWith('/api/') || reqPath.startsWith('/auth/')) {
      return c.json({ error: { code: 'NOT_FOUND', message: `路径 ${reqPath} 不存在` } }, 404)
    }
    if (resolvedWebDir && fs.existsSync(resolvedWebDir)) {
      const indexHtml = path.join(resolvedWebDir, 'index.html')
      const serveIndex = () => {
        const html = fs
          .readFileSync(indexHtml, 'utf8')
          .replace(
            '</head>',
            `<script>window.__AKASHA_CONFIG__=${JSON.stringify({ sandboxOrigin: activeSandboxSrv.origin })};</script></head>`,
          )
        return c.html(html, 200, { 'Cache-Control': 'no-store' })
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
      `<!doctype html><html><head><meta charset="utf-8"><title>Akasha Terminal</title></head><body><h1>Akasha Terminal v${version}</h1><p>Daemon running on ${activeNodeSrv.baseUrl} · Sandbox ${activeSandboxSrv.origin}</p></body></html>`,
    )
  })

  const state: DaemonStateFile = {
    pid: process.pid,
    host,
    port: activeNodeSrv.port,
    sandboxPort: activeSandboxSrv.port,
    token: activeNodeSrv.token,
    version,
    startedAt: activeNodeSrv.daemonState.startedAt,
    dbPath,
  }
  writeDaemonState(homeDir, state)

  let closed = false
  let idleTimer: ReturnType<typeof setInterval> | undefined
  let lastActivityMs = Date.now()

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
      await Promise.all([activeNodeSrv.close(), activeSandboxSrv.close()])
    } finally {
      lock.release()
    }
  }

  return {
    state,
    baseUrl: activeNodeSrv.baseUrl,
    wsUrl: activeNodeSrv.wsUrl,
    sandboxOrigin: activeSandboxSrv.origin,
    token: activeNodeSrv.token,
    nodeSrv: activeNodeSrv,
    sandboxSrv: activeSandboxSrv,
    close: closeAll,
  }
}
