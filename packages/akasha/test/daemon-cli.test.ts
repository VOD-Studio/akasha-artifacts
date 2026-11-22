import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureDaemon, probeDaemon, stopDaemon } from '../src/daemon/lifecycle.js'
import { startAkashaDaemon } from '../src/daemon/serve.js'
import { daemonStatePath } from '../src/daemon/state.js'

const closers: Array<() => Promise<void>> = []
const tempDirs: string[] = []

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) await close()
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('Local singleton Daemon lifecycle & security', () => {
  it('reuses one singleton Daemon across multiple projects, enforces 0600 daemon.json, and sets sandbox CSP', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-home-'))
    const projA = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-proj-a-'))
    const projB = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-proj-b-'))
    tempDirs.push(homeDir, projA, projB)

    let activeDaemon: Awaited<ReturnType<typeof startAkashaDaemon>> | undefined
    const launcher = async (opts: {
      homeDir: string
      host: string
      port?: number
      sandboxPort?: number
      dbPath?: string
      version: string
    }) => {
      activeDaemon = await startAkashaDaemon({
        homeDir: opts.homeDir,
        host: opts.host,
        port: opts.port ?? 0,
        sandboxPort: opts.sandboxPort ?? 0,
        dbPath: opts.dbPath,
        version: opts.version,
      })
      closers.push(activeDaemon.close)
    }

    // 项目 A 拉起 Daemon
    const first = await ensureDaemon({ homeDir, projectDir: projA, version: '0.1.0', launcher })
    expect(first.reused).toBe(false)
    expect(first.replaced).toBe(false)
    expect(first.projectId).toBeTruthy()

    // 已有单例运行时，直接再次 startAkashaDaemon 必须被单例锁拒绝，不能退回备用端口另起第二个进程
    await expect(startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0 })).rejects.toThrow(
      /已在运行/,
    )

    // 检查 daemon.json 文件权限为 0600
    const mode = fs.statSync(daemonStatePath(homeDir)).mode & 0o777
    expect(mode).toBe(0o600)

    // 项目 B 复用同一个 Daemon 与相同端口
    const second = await ensureDaemon({ homeDir, projectDir: projB, version: '0.1.0', launcher })
    expect(second.reused).toBe(true)
    expect(second.state.port).toBe(first.state.port)
    expect(second.projectId).not.toBe(first.projectId)

    // 验证独立沙盒端口响应头含 connect-src 'none' 与精确 frame-ancestors
    const sbRes = await fetch(`http://127.0.0.1:${first.state.sandboxPort}/`)
    expect(sbRes.status).toBe(200)
    const csp = sbRes.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain(`http://127.0.0.1:${first.state.port}`)

    // 验证一次性访问码（OTC）换取 HttpOnly Cookie 且拒绝重放与开放重定向
    const badNext = await fetch(`${first.baseUrl}/api/v1/auth/otc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${first.state.token}`,
      },
      body: JSON.stringify({ next: '//evil.example' }),
    })
    expect(badNext.status).toBe(400)

    const otcRes = await fetch(`${first.baseUrl}/api/v1/auth/otc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${first.state.token}`,
      },
      body: JSON.stringify({ next: '/a/test123' }),
    })
    expect(otcRes.status).toBe(201)
    const { openPath } = (await otcRes.json()) as { openPath: string }

    const openRes = await fetch(`${first.baseUrl}${openPath}`, { redirect: 'manual' })
    expect(openRes.status).toBe(302)
    expect(openRes.headers.get('location')).toBe('/a/test123')
    const setCookie = openRes.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('akasha_session=')
    expect(setCookie).toContain('HttpOnly')

    // 重放同一 OTC 必须被拒绝（401）
    const replayRes = await fetch(`${first.baseUrl}${openPath}`, { redirect: 'manual' })
    expect(replayRes.status).toBe(401)
  })

  it('replaces running Daemon smoothly on version upgrade while preserving custom dbPath and artifact URLs', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-upgrade-'))
    const customDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-custom-db-'))
    const customDbPath = path.join(customDbDir, 'custom.db')
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-proj-up-'))
    tempDirs.push(homeDir, customDbDir, proj)

    const launcher = async (opts: {
      homeDir: string
      host: string
      port?: number
      sandboxPort?: number
      dbPath?: string
      version: string
    }) => {
      const d = await startAkashaDaemon({
        homeDir: opts.homeDir,
        host: opts.host,
        port: opts.port ?? 0,
        sandboxPort: opts.sandboxPort ?? 0,
        dbPath: opts.dbPath,
        version: opts.version,
      })
      closers.push(d.close)
    }

    const v1Daemon = await ensureDaemon({
      homeDir,
      projectDir: proj,
      dbPath: customDbPath,
      version: '0.1.0',
      launcher,
    })
    expect(v1Daemon.state.dbPath).toBe(customDbPath)
    const pubRes = await fetch(`${v1Daemon.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${v1Daemon.state.token}`,
      },
      body: JSON.stringify({
        project: v1Daemon.projectId,
        slug: 'html/persist-me',
        title: 'Persist',
        type: 'html',
        source: '<p>survives upgrade</p>',
      }),
    })
    const { artifact } = (await pubRes.json()) as { artifact: { publicId: string } }

    // 升级版本为 0.2.0（不显式传 dbPath）→ 平滑替换并继承原端口与自定义 dbPath，既有 Artifact 链接仍可访问
    const v2Daemon = await ensureDaemon({ homeDir, projectDir: proj, version: '0.2.0', launcher })
    expect(v2Daemon.replaced).toBe(true)
    expect(v2Daemon.reused).toBe(false)
    expect(v2Daemon.state.port).toBe(v1Daemon.state.port)
    expect(v2Daemon.state.dbPath).toBe(customDbPath)
    expect(v2Daemon.state.version).toBe('0.2.0')

    const readRes = await fetch(`${v2Daemon.baseUrl}/api/v1/artifacts/${artifact.publicId}`)
    expect(readRes.status).toBe(200)
    const body = (await readRes.json()) as { version: { source: string } }
    expect(body.version.source).toBe('<p>survives upgrade</p>')

    // stopDaemon 停止进程并清理 daemon.json
    const stopped = await stopDaemon(homeDir)
    expect(stopped.stopped).toBe(true)
    expect(await probeDaemon(homeDir)).toBeNull()
  })
})
