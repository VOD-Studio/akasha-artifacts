import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { AsyncWakeupMonitor, fetchPromptContext, type WakeupBatch } from '@akasha/hooks'
import { AkashaApiError, AkashaHttpClient } from '@akasha/mcp'
import { evaluateSkillCompliance } from '@akasha/skills'
import { afterEach, describe, expect, it } from 'vitest'
import { startAkashaDaemon } from '../src/daemon/serve.js'

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

function sendRawHttpRequest(options: {
  port: number
  method: string
  path: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}

describe('端到端全链路闭环与安全回归（Daemon + MCP Client + WS Hooks + Sandbox CSP）', () => {
  it('覆盖发布 → 活跃轮次草稿防打断 → Hook 选区上下文注入 → 提交整轮合并唤醒 → receipt/ack → 409 冲突', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-e2e-home-'))
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-e2e-proj-'))
    tempDirs.push(homeDir, projDir)

    const daemon = await startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0 })
    closers.push(daemon.close)

    const regRes = await fetch(`${daemon.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({ rootPath: projDir, name: 'e2e-project' }),
    })
    expect(regRes.status).toBe(201)
    const { project } = (await regRes.json()) as { project: { id: string } }

    const agentClient = new AkashaHttpClient({
      baseUrl: daemon.baseUrl,
      token: daemon.token,
      defaultProject: project.id,
    })

    // 1. 按需读 spec + check 门禁 + publish v1
    const spec = await agentClient.spec('html')
    expect(spec.type).toBe('html')

    const v1Source = '<section data-ak-id="pricing"><h2>Pricing</h2><button>Buy</button></section>'
    const checkRes = await agentClient.check({ type: 'html', source: v1Source })
    expect(checkRes.ok).toBe(true)

    const pub = await agentClient.publish({
      slug: 'html/pricing-card',
      title: 'Pricing Card',
      type: 'html',
      source: v1Source,
    })
    expect(pub.version.version).toBe(1)
    const publicId = pub.artifact.publicId

    // 2. 启动真实 WS AsyncWakeupMonitor 监听该项目
    const wakeups: WakeupBatch[] = []
    const monitor = new AsyncWakeupMonitor({
      wsUrl: daemon.wsUrl,
      projectId: project.id,
      debounceMs: 80,
      onWakeup: (batch) => wakeups.push(batch),
    })
    monitor.start()
    closers.push(async () => monitor.stop())
    await new Promise((r) => setTimeout(r, 120))

    // 3. 开启活跃评审轮次，连续写入两条草稿批注 + 选择方案（均不唤醒 Agent）
    const openRoundRes = await fetch(`${daemon.baseUrl}/api/v1/artifacts/${publicId}/rounds`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({
        project: project.id,
        groups: [
          {
            id: 'tier',
            title: '默认高亮档位',
            kind: 'choose',
            options: ['pro', 'team'],
            choice: null,
          },
        ],
      }),
    })
    expect(openRoundRes.status).toBe(201)
    const { round } = (await openRoundRes.json()) as { round: { id: string } }

    for (const bodyText of ['把价格字号调大', '按钮文案改成立即开通']) {
      const fbRes = await fetch(`${daemon.baseUrl}/api/v1/artifacts/${publicId}/feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${daemon.token}`,
        },
        body: JSON.stringify({
          project: project.id,
          version: 1,
          roundId: round.id,
          kind: 'comment',
          element: { blockId: 'pricing', textPreview: 'Pricing' },
          body: bodyText,
          author: 'human:sun',
        }),
      })
      expect(fbRes.status).toBe(201)
      const { feedback } = (await fbRes.json()) as { feedback: { draft: boolean } }
      expect(feedback.draft).toBe(true)
    }

    await fetch(`${daemon.baseUrl}/api/v1/artifacts/${publicId}/verdict`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({
        project: project.id,
        roundId: round.id,
        groupId: 'tier',
        choice: 'pro',
        fromAgent: false,
      }),
    })

    // 浏览器同步当前选中元素与未发草稿 → Hook 仅读取摘要且不推进游标，也不提前唤醒 Agent
    await fetch(`${daemon.baseUrl}/api/v1/projects/${project.id}/selection`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({
        artifactId: publicId,
        element: { blockId: 'pricing', loc: '1:1', textPreview: 'Pricing' },
        draftText: '这块的圆角也调大一点',
      }),
    })

    await new Promise((r) => setTimeout(r, 180))
    expect(wakeups).toHaveLength(0)

    const injected = await fetchPromptContext({
      baseUrl: daemon.baseUrl,
      token: daemon.token,
      projectId: project.id,
    })
    expect(injected).toContain('blockId=pricing')
    expect(injected).toContain('这块的圆角也调大一点')
    expect(injected).not.toContain('把价格字号调大')

    // 4. 点击「提交本轮」→ 打包送达并触发单次合并唤醒
    const submitRes = await fetch(
      `${daemon.baseUrl}/api/v1/artifacts/${publicId}/rounds/${round.id}/submit`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${daemon.token}` },
      },
    )
    expect(submitRes.status).toBe(200)

    await new Promise((r) => setTimeout(r, 200))
    expect(wakeups).toHaveLength(1)
    expect(wakeups[0]?.reasons).toContain('round.submitted')

    // 提交后 Hook 再次拉取项目级上下文也能看到已提交轮次摘要（不推进游标）
    const injectedAfterSubmit = await fetchPromptContext({
      baseUrl: daemon.baseUrl,
      token: daemon.token,
      projectId: project.id,
    })
    expect(injectedAfterSubmit).toContain('默认高亮档位=pro')

    // 5. Agent 拉取完整反馈 + receipt，并凭 receipt 确认与解决线程
    const pulled = await agentClient.pullFeedback({ id: publicId, detail: true })
    expect(pulled.items).toHaveLength(2)
    expect(pulled.items.every((i) => i.draft === false)).toBe(true)
    expect(pulled.rounds[0]?.status).toBe('submitted')
    expect(pulled.rounds[0]?.groups[0]?.choice).toBe('pro')
    expect(pulled.receipt).toBeTruthy()

    const acked = await agentClient.ackFeedback({
      receipt: pulled.receipt ?? '',
      resolveIds: pulled.items.map((i) => i.id),
    })
    expect(acked.acknowledged).toBe(2)
    expect(acked.resolved).toBe(2)

    // 行为合规回放：验证完整轨迹通过 Skill 门禁
    const compliance = evaluateSkillCompliance({
      name: 'e2e-full-loop',
      events: [
        { tool: 'artifact_spec', args: { type: 'html' } },
        { tool: 'artifact_check', args: { type: 'html' }, result: { ok: true } },
        { tool: 'artifact_publish', args: { type: 'html' } },
        {
          tool: 'artifact_pull_feedback',
          args: { id: publicId, detail: true },
          result: { receipt: pulled.receipt },
        },
        {
          tool: 'artifact_ack_feedback',
          args: { receipt: pulled.receipt, resolve: pulled.items.map((i) => i.id) },
        },
      ],
    })
    expect(compliance.passed).toBe(true)

    // 6. 人类保存 v2 后，Agent 携带过期 baseVersion=1 修改必须收到 409 VERSION_CONFLICT 与 diff
    const humanEditRes = await fetch(`${daemon.baseUrl}/api/v1/artifacts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({
        project: project.id,
        slug: 'html/pricing-card',
        title: 'Pricing Card Human',
        type: 'html',
        source: '<section data-ak-id="pricing"><h2>Pro Pricing</h2><button>Buy</button></section>',
        baseVersion: 1,
        author: 'human:sun',
      }),
    })
    expect(humanEditRes.status).toBe(200)

    let caughtErr: unknown
    try {
      await agentClient.update({
        id: publicId,
        baseVersion: 1,
        edits: [{ old_str: '<button>Buy</button>', new_str: '<button>立即开通</button>' }],
      })
    } catch (err) {
      caughtErr = err
    }
    expect(caughtErr).toBeInstanceOf(AkashaApiError)
    const apiErr = caughtErr as AkashaApiError
    expect(apiErr.status).toBe(409)
    expect(apiErr.toAgentMessage()).toContain('Pro Pricing')
  })

  it('安全回归：拒绝伪造 Host（DNS rebinding）、跨站 Origin、未鉴权写操作，并核验独立沙盒 Origin 与严格 CSP', async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-sec-home-'))
    tempDirs.push(homeDir)

    const daemon = await startAkashaDaemon({ homeDir, port: 0, sandboxPort: 0 })
    closers.push(daemon.close)

    // 1. 沙盒与外壳端口必须分离（不同 Origin），沙盒 CSP 必须包含 connect-src 'none' 与精确 frame-ancestors
    expect(daemon.state.sandboxPort).not.toBe(daemon.state.port)
    const sbRes = await fetch(`${daemon.sandboxOrigin}/`)
    expect(sbRes.status).toBe(200)
    const csp = sbRes.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('frame-ancestors')
    expect(csp).toContain(`http://127.0.0.1:${daemon.state.port}`)

    // 2. OTC 颁发的会话 Cookie 必须为 HttpOnly + SameSite=Lax，沙盒域与脚本无法读取
    const otcRes = await fetch(`${daemon.baseUrl}/api/v1/auth/otc`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${daemon.token}`,
      },
      body: JSON.stringify({ next: '/' }),
    })
    const { openPath } = (await otcRes.json()) as { openPath: string }
    const openRes = await fetch(`${daemon.baseUrl}${openPath}`, { redirect: 'manual' })
    const setCookie = openRes.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')

    // 3. 伪造 Host 头（DNS rebinding 攻击）必须被 403 拒绝
    const badHost = await sendRawHttpRequest({
      port: daemon.state.port,
      method: 'GET',
      path: '/api/v1/health',
      headers: { host: `evil.example:${daemon.state.port}` },
    })
    expect(badHost.status).toBe(403)
    expect(badHost.body).toContain('FORBIDDEN')

    // 4. 跨站 Origin 发起写请求必须被 403 拒绝
    const badOrigin = await sendRawHttpRequest({
      port: daemon.state.port,
      method: 'POST',
      path: '/api/v1/projects',
      headers: {
        host: `127.0.0.1:${daemon.state.port}`,
        origin: 'https://attacker.example',
        authorization: `Bearer ${daemon.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rootPath: '/tmp/evil', name: 'evil' }),
    })
    expect(badOrigin.status).toBe(403)
    expect(badOrigin.body).toContain('FORBIDDEN')

    // 5. 未携带 Token 或会话 Cookie 的写操作必须被 401 拒绝
    const unauth = await fetch(`${daemon.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rootPath: '/tmp/unauth', name: 'unauth' }),
    })
    expect(unauth.status).toBe(401)
  })
})
