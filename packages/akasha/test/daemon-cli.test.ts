import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { ArtifactSchema } from '@akasha/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../src/cli.js'
import { ensureDaemon, probeDaemon, stopDaemon } from '../src/daemon/lifecycle.js'
import { startAkashaDaemon } from '../src/daemon/serve.js'
import { daemonStatePath } from '../src/daemon/state.js'
import {
  installHarnessPlugin,
  resolveHarnessPaths,
  runDoctor,
  SUPPORTED_HARNESSES,
} from '../src/install/index.js'

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

  it('只为已绑定的 Hub 确认本机制品版本，不向其传出制品或凭据', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-hub-probe-'))
    tempDirs.push(homeDir)
    const daemon = await startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0, dbPath: 'memory' })
    closers.push(daemon.close)
    const published = await fetch(`${daemon.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemon.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'local-copy',
        title: '本机副本',
        type: 'html',
        source: '<b>A</b>',
      }),
    })
    expect(published.status).toBe(201)
    const payload: unknown = await published.json()
    const artifact = ArtifactSchema.parse(
      payload && typeof payload === 'object' && 'artifact' in payload
        ? payload.artifact
        : undefined,
    )
    const url = `${daemon.baseUrl}/api/v1/local-artifact/${artifact.publicId}`
    const origin = 'https://hub.example.test'
    const probe = (target: string, requestOrigin: string) =>
      fetch(target, { headers: { Origin: requestOrigin } })
    expect((await probe(url, origin)).status).toBe(404)

    fs.writeFileSync(
      path.join(homeDir, 'hub-login.json'),
      JSON.stringify({ origin, token: 'fixture', expiresAt: new Date(Date.now() + 60_000) }),
      { mode: 0o600 },
    )
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true')
    const hit = await probe(`${url}?version=1`, origin)
    expect(hit.status).toBe(204)
    expect(hit.headers.get('access-control-allow-origin')).toBe(origin)
    expect(hit.headers.has('set-cookie')).toBe(false)
    expect(await hit.text()).toBe('')
    expect((await probe(`${url}?version=2`, origin)).status).toBe(404)
    const wrongHub = await probe(url, 'https://other.example.test')
    expect(wrongHub.status).toBe(404)
    expect(wrongHub.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('在根页与 SPA 回退页注入相同沙盒地址，并禁止外框加载其他来源', async () => {
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

    for (const pathname of ['/', '/a/AbCdEfGhIjKlMnOpQrStU']) {
      const response = await fetch(`${daemon.baseUrl}${pathname}`)
      expect(response.headers.get('Content-Security-Policy')).toBe(
        `frame-src ${daemon.sandboxOrigin}`,
      )
      const html = await response.text()
      expect(html).toContain('window.__AKASHA_CONFIG__=')
      expect(html).toContain(daemon.sandboxOrigin)
    }
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

  it('installHarnessPlugin writes native MCP & Hook locations/formats idempotently for all 4 harnesses', async () => {
    const fakeUserHome = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-user-home-'))
    tempDirs.push(fakeUserHome)

    // 预置用户已有原生配置：~/.claude.json、~/.codex/config.toml、~/.cursor/hooks.json、~/.gemini/antigravity/mcp_config.json
    fs.writeFileSync(
      path.join(fakeUserHome, '.claude.json'),
      JSON.stringify({
        numStartups: 7,
        mcpServers: { existingClaude: { command: 'echo', args: ['hi'] } },
      }),
    )
    fs.mkdirSync(path.join(fakeUserHome, '.claude'), { recursive: true })
    fs.writeFileSync(
      path.join(fakeUserHome, '.claude', 'settings.json'),
      JSON.stringify({
        theme: 'dark',
        hooks: {
          UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo user' }] }],
        },
      }),
    )

    fs.mkdirSync(path.join(fakeUserHome, '.codex'), { recursive: true })
    fs.writeFileSync(
      path.join(fakeUserHome, '.codex', 'config.toml'),
      'model = "o3"\n\n[mcp_servers.existing]\ncommand = "echo"\nargs = ["ok"]\n',
    )

    fs.mkdirSync(path.join(fakeUserHome, '.cursor'), { recursive: true })
    fs.writeFileSync(
      path.join(fakeUserHome, '.cursor', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          beforeSubmitPrompt: [{ command: 'echo user-cursor-hook' }],
        },
      }),
    )

    fs.mkdirSync(path.join(fakeUserHome, '.gemini', 'antigravity'), { recursive: true })
    fs.writeFileSync(
      path.join(fakeUserHome, '.gemini', 'antigravity', 'mcp_config.json'),
      JSON.stringify({ mcpServers: { existingAgy: { command: 'echo', args: ['agy'] } } }),
    )

    for (const harness of SUPPORTED_HARNESSES) {
      const first = installHarnessPlugin({ harness, homeDir: fakeUserHome })
      expect(first.skillsInstalled).toEqual(['akasha-artifacts', 'akasha-review-loop'])
      // 幂等重复安装不得重复追加或破坏现有配置
      installHarnessPlugin({ harness, homeDir: fakeUserHome })

      const doctor = await runDoctor({
        akashaHome: path.join(fakeUserHome, '.akasha'),
        homeDir: fakeUserHome,
        harness,
      })
      expect(doctor.checks.find((c) => c.id === `harness:${harness}`)?.status).toBe('ok')
    }

    // 1. Claude Code：用户级 MCP 写入 ~/.claude.json，保留 numStartups 与既有 mcpServers，Hooks 写入 ~/.claude/settings.json
    const claudePaths = resolveHarnessPaths('claude-code', { homeDir: fakeUserHome })
    expect(claudePaths.mcpConfigPath).toBe(path.join(fakeUserHome, '.claude.json'))
    const claudeMcp = JSON.parse(fs.readFileSync(claudePaths.mcpConfigPath, 'utf8')) as {
      numStartups: number
      mcpServers: Record<string, unknown>
    }
    expect(claudeMcp.numStartups).toBe(7)
    expect(claudeMcp.mcpServers.existingClaude).toBeDefined()
    expect(claudeMcp.mcpServers.akasha).toBeDefined()
    const claudeSettings = JSON.parse(fs.readFileSync(claudePaths.hooksConfigPath, 'utf8')) as {
      theme: string
      hooks: Record<string, unknown[]>
    }
    expect(claudeSettings.theme).toBe('dark')
    expect(claudeSettings.hooks.UserPromptSubmit).toHaveLength(2)

    // 2. Codex：MCP 以 TOML [mcp_servers.akasha] 写入 ~/.codex/config.toml，保留原 model 与既有表
    const codexPaths = resolveHarnessPaths('codex', { homeDir: fakeUserHome })
    expect(codexPaths.mcpConfigPath).toBe(path.join(fakeUserHome, '.codex', 'config.toml'))
    const codexToml = fs.readFileSync(codexPaths.mcpConfigPath, 'utf8')
    expect(codexToml).toContain('model = "o3"')
    expect(codexToml).toContain('[mcp_servers.existing]')
    expect(codexToml.match(/\[mcp_servers\.akasha\]/g)).toHaveLength(1)
    expect(codexToml).toContain('args = ["-y", "akasha-artifacts", "mcp"]')

    // 3. Cursor：Hooks 按原生 { version: 1, hooks: { beforeSubmitPrompt, preToolUse, postToolUse, sessionEnd } } 结构合并
    const cursorPaths = resolveHarnessPaths('cursor', { homeDir: fakeUserHome })
    const cursorHooks = JSON.parse(fs.readFileSync(cursorPaths.hooksConfigPath, 'utf8')) as {
      version: number
      hooks: Record<string, Array<{ command: string }>>
    }
    expect(cursorHooks.version).toBe(1)
    expect(cursorHooks.hooks.beforeSubmitPrompt).toHaveLength(2)
    expect(cursorHooks.hooks.beforeSubmitPrompt?.[0]?.command).toBe('echo user-cursor-hook')
    expect(cursorHooks.hooks.beforeSubmitPrompt?.[1]?.command).toContain(
      'hook prompt --harness cursor',
    )
    expect(cursorHooks.hooks.sessionEnd).toHaveLength(1)

    // 4. Antigravity：保留已有 mcp_config.json 服务器并写入 akasha
    const agyPaths = resolveHarnessPaths('antigravity', { homeDir: fakeUserHome })
    const agyMcp = JSON.parse(fs.readFileSync(agyPaths.mcpConfigPath, 'utf8')) as {
      mcpServers: Record<string, unknown>
    }
    expect(agyMcp.mcpServers.existingAgy).toBeDefined()
    expect(agyMcp.mcpServers.akasha).toBeDefined()

    // 5. 显式 --dir 时 Claude Code 写入项目级 <dir>/.mcp.json，绝不越界污染用户家目录
    const customProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-claude-proj-'))
    tempDirs.push(customProjectDir)
    const customInstall = installHarnessPlugin({
      harness: 'claude-code',
      targetDir: customProjectDir,
    })
    expect(customInstall.mcpConfigPath).toBe(path.join(customProjectDir, '.mcp.json'))
    expect(fs.existsSync(customInstall.mcpConfigPath)).toBe(true)
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
    expect(regRes.status).toBe(201)
    const { project } = (await regRes.json()) as { project: { id: string } }

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${daemon.token}`,
    }
    const published = await fetch(`${daemon.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: project.id,
        slug: 'hook-hero',
        title: 'Hook 选区',
        type: 'html',
        source: '<h1 data-ak-id="hero-title">欢迎使用 Akasha</h1>',
      }),
    })
    expect(published.status).toBe(201)
    const { artifact } = (await published.json()) as { artifact: { publicId: string } }
    const selection = await fetch(`${daemon.baseUrl}/api/v1/projects/${project.id}/selection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        artifactId: artifact.publicId,
        element: { blockId: 'hero-title', textPreview: '欢迎使用 Akasha' },
        draftText: '标题改短一些',
      }),
    })
    expect(selection.ok).toBe(true)

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
