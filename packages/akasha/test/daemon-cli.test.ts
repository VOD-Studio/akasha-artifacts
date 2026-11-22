import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { ensureDaemon, probeDaemon, stopDaemon } from '../src/daemon/lifecycle.js'
import { startAkashaDaemon } from '../src/daemon/serve.js'
import { daemonStatePath } from '../src/daemon/state.js'
import { installHarnessPlugin, runDoctor, SUPPORTED_HARNESSES } from '../src/install/index.js'

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
    expect(sbRes.headers.get('access-control-allow-origin')).toBe('*')

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

    // 移除项目登记（DELETE /api/v1/projects/:id）
    const delRes = await fetch(`${first.baseUrl}/api/v1/projects/${second.projectId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${first.state.token}` },
    })
    expect(delRes.status).toBe(200)
  })

  it('injects window.__AKASHA_CONFIG__ on root "/" as well as SPA fallback routes', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-web-cfg-'))
    const fakeWebDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fake-web-'))
    tempDirs.push(homeDir, fakeWebDir)
    fs.writeFileSync(
      path.join(fakeWebDir, 'index.html'),
      '<!doctype html><html><head><title>Shell</title></head><body><div id="root"></div></body></html>',
    )

    const daemon = await startAkashaDaemon({
      homeDir,
      port: 0,
      sandboxPort: 0,
      webDir: fakeWebDir,
    })
    closers.push(daemon.close)

    const rootHtml = await (await fetch(`${daemon.baseUrl}/`)).text()
    expect(rootHtml).toContain('window.__AKASHA_CONFIG__=')
    expect(rootHtml).toContain(daemon.sandboxOrigin)

    const spaHtml = await (await fetch(`${daemon.baseUrl}/a/AbCdEfGhIjKlMnOpQrStU`)).text()
    expect(spaHtml).toContain('window.__AKASHA_CONFIG__=')
    expect(spaHtml).toContain(daemon.sandboxOrigin)
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

  it('installHarnessPlugin supports all 4 harnesses idempotently without clobbering existing user configs', () => {
    for (const harness of SUPPORTED_HARNESSES) {
      const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), `akasha-install-${harness}-`))
      tempDirs.push(targetDir)

      // 预置用户已有 MCP 与 Hooks 配置
      const mcpFile = path.join(
        targetDir,
        harness === 'antigravity' ? 'mcp_config.json' : 'mcp.json',
      )
      fs.writeFileSync(
        mcpFile,
        JSON.stringify({ mcpServers: { existingTool: { command: 'echo', args: ['hi'] } } }),
      )
      const hooksFile = path.join(
        targetDir,
        harness === 'claude-code' ? 'settings.json' : 'hooks.json',
      )
      fs.writeFileSync(
        hooksFile,
        harness === 'claude-code'
          ? JSON.stringify({
              theme: 'dark',
              hooks: {
                UserPromptSubmit: [
                  { matcher: '*', hooks: [{ type: 'command', command: 'echo user' }] },
                ],
              },
            })
          : JSON.stringify({ customHook: 'echo keep-me' }),
      )

      const first = installHarnessPlugin({ harness, targetDir })
      expect(first.skillsInstalled).toEqual(['akasha-artifacts', 'akasha-review-loop'])
      expect(fs.existsSync(path.join(targetDir, 'skills', 'akasha-artifacts', 'SKILL.md'))).toBe(
        true,
      )

      // 幂等重复安装不得重复追加相同 Hook，且保留用户已有配置
      installHarnessPlugin({ harness, targetDir })
      const mcp = JSON.parse(fs.readFileSync(mcpFile, 'utf8')) as {
        mcpServers: Record<string, unknown>
      }
      expect(mcp.mcpServers.existingTool).toBeDefined()
      expect(mcp.mcpServers.akasha).toBeDefined()

      const hooks = JSON.parse(fs.readFileSync(hooksFile, 'utf8')) as Record<string, unknown>
      if (harness === 'claude-code') {
        expect(hooks.theme).toBe('dark')
        const submitList = (hooks.hooks as Record<string, unknown[]>).UserPromptSubmit
        expect(submitList).toHaveLength(2)
      } else {
        expect(hooks.customHook).toBe('echo keep-me')
      }
    }
  })

  it('runDoctor verifies Daemon health, harness install completeness, and port conflicts', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-doc-home-'))
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-doc-claude-'))
    tempDirs.push(homeDir, installDir)

    // 未安装插件时 doctor 明确报 error
    const missingReport = await runDoctor({
      akashaHome: homeDir,
      harness: 'claude-code',
      targetDir: installDir,
    })
    expect(missingReport.ok).toBe(false)
    expect(missingReport.checks.find((c) => c.id === 'harness:claude-code')?.status).toBe('error')

    // 安装插件并启动 Daemon 后全部通过
    installHarnessPlugin({ harness: 'claude-code', targetDir: installDir })
    const daemon = await startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0 })
    closers.push(daemon.close)

    const okReport = await runDoctor({
      akashaHome: homeDir,
      harness: 'claude-code',
      targetDir: installDir,
    })
    expect(okReport.ok).toBe(true)
    expect(okReport.checks.find((c) => c.id === 'daemon')?.status).toBe('ok')
    expect(okReport.checks.find((c) => c.id === 'harness:claude-code')?.status).toBe('ok')

    // 占满全部候选端口时，doctor 能检测到端口冲突
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()))
    closers.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())))
    const blockedPort = (blocker.address() as net.AddressInfo).port
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-doc-empty-'))
    tempDirs.push(emptyHome)

    const conflictReport = await runDoctor({
      akashaHome: emptyHome,
      shellPorts: [blockedPort],
      sandboxPorts: [blockedPort],
    })
    expect(conflictReport.ok).toBe(false)
    expect(conflictReport.checks.find((c) => c.id === 'ports')?.status).toBe('error')
  })

  it('CLI hook prompt & activity resolve project by rootPath and emit harness-formatted context', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-hook-cli-home-'))
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-hook-cli-proj-'))
    tempDirs.push(homeDir, projDir)

    const daemon = await startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0 })
    closers.push(daemon.close)

    // 登记项目并写入浏览器选区
    const regRes = await fetch(`${daemon.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({ rootPath: projDir, name: 'hook-cli-proj' }),
    })
    const { project } = (await regRes.json()) as { project: { id: string } }

    await fetch(`${daemon.baseUrl}/api/v1/projects/${project.id}/selection`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({
        artifactId: 'AbCdEfGhIjKlMnOpQrStU',
        element: { blockId: 'hero-title', textPreview: '欢迎使用 Akasha' },
        draftText: '标题改短一些',
      }),
    })

    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
      logs.push(String(msg))
    })
    try {
      const code = await runCli([
        'hook',
        'prompt',
        '--harness',
        'claude-code',
        '--home',
        homeDir,
        '--project',
        projDir,
      ])
      expect(code).toBe(0)
      const parsed = JSON.parse(logs.at(-1) ?? '{}') as {
        hookSpecificOutput?: { additionalContext?: string }
      }
      expect(parsed.hookSpecificOutput?.additionalContext).toContain('blockId=hero-title')
      expect(parsed.hookSpecificOutput?.additionalContext).toContain('标题改短一些')

      const actCode = await runCli([
        'hook',
        'activity',
        '--event',
        'PreToolUse',
        '--home',
        homeDir,
        '--project',
        projDir,
      ])
      expect(actCode).toBe(0)
    } finally {
      logSpy.mockRestore()
    }
  })
})
