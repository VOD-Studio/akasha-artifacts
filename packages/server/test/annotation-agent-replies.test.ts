import type { AnnotationThread, Feedback } from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import type { AgentRunnerLaunch } from '../src/domain/agent-runner.js'

interface LaunchEntry {
  request: AgentRunnerLaunch
  resolve: (text: string) => void
  reject: (err: Error) => void
}

function createFixture(dbPath: 'memory' | ':memory:' = 'memory') {
  const launches: LaunchEntry[] = []
  const container = createLocalContainer({
    dbPath,
    agentRunner: {
      check: async () => undefined,
      run: (request) =>
        new Promise<string>((resolve, reject) => {
          request.onThread(request.threadId ?? '29f7e3f3-cfe3-497e-a080-ee5fd08780ec')
          request.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          })
          launches.push({ request, resolve, reject })
        }),
    },
  })
  const cli = { Authorization: `Bearer ${container.token}` }
  const browser = { Cookie: `akasha_session=${container.token}`, Origin: 'http://127.0.0.1:24321' }
  const req = (path: string, method: string, headers: Record<string, string>, body?: unknown) =>
    container.app.request(`http://127.0.0.1:24321/api/v1${path}`, {
      method,
      headers: { Host: '127.0.0.1:24321', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  async function publishBoundArtifact() {
    expect(
      (
        await req('/projects', 'POST', cli, {
          id: 'design',
          name: 'design',
          rootPath: '/tmp/design',
        })
      ).status,
    ).toBe(201)
    expect((await req('/agent/connections', 'POST', cli, { projectId: 'design' })).status).toBe(200)
    expect(
      (
        await req('/agent/design', 'POST', browser, {
          projectId: 'design',
          message: '创建首版设计',
        })
      ).status,
    ).toBe(202)
    await vi.waitFor(() => expect(launches).toHaveLength(1))
    const first = launches[0]
    if (!first) throw new Error('missing initial turn')
    const tool = { Authorization: `Bearer ${first.request.token}` }
    const created = await req('/agent/tool/artifacts', 'POST', tool, {
      project: 'design',
      slug: 'landing',
      title: '落地页',
      type: 'html',
      source: '<main><h1 data-ak-block="hero-title">旧标题</h1></main>',
    })
    expect(created.status).toBe(201)
    const { artifact } = (await created.json()) as { artifact: { publicId: string } }
    first.resolve('已发布首版落地页。')
    await vi.waitFor(async () => {
      const res = await req(`/artifacts/${artifact.publicId}/agent-session`, 'GET', browser)
      const data = (await res.json()) as { availability: string }
      expect(data.availability).toBe('ready')
    })
    return artifact.publicId
  }

  async function listReview(artifactId: string, includeDrafts = true) {
    const res = await req(
      `/artifacts/${artifactId}/feedback?includeDrafts=${includeDrafts}`,
      'GET',
      browser,
    )
    expect(res.status).toBe(200)
    return (await res.json()) as { items: Feedback[]; threads: Record<string, AnnotationThread> }
  }

  return { container, launches, cli, browser, req, publishBoundArtifact, listReview }
}

it.each(['memory', ':memory:'] as const)(
  '同对象双线程仅将显式发送项投递给已绑定 Agent，并在原线程回写回复与版本（%s）',
  async (dbPath) => {
    const { container, launches, browser, req, publishBoundArtifact, listReview } =
      createFixture(dbPath)
    try {
      const artifactId = await publishBoundArtifact()
      const targetElement = { blockId: 'hero-title', textPreview: '旧标题' }

      // 线程 1：仅供同事讨论（audience: 'human'），绝不触发 Agent。
      const humanRes = await req(`/artifacts/${artifactId}/feedback`, 'POST', browser, {
        project: 'design',
        version: 1,
        kind: 'comment',
        audience: 'human',
        element: targetElement,
        body: '请设计同事帮忙看下这里字号',
      })
      expect(humanRes.status).toBe(201)
      const { feedback: humanFb } = (await humanRes.json()) as { feedback: Feedback }
      expect(launches).toHaveLength(1)

      // 线程 2：明确发给 Agent（audience: 'agent'），到达绑定会话并携带原对象定位。
      const agentRes = await req(`/artifacts/${artifactId}/feedback`, 'POST', browser, {
        project: 'design',
        version: 1,
        kind: 'comment',
        audience: 'agent',
        element: targetElement,
        body: '把标题改成「新标题」并发布新版',
      })
      expect(agentRes.status).toBe(201)
      const { feedback: agentFb } = (await agentRes.json()) as { feedback: Feedback }
      await vi.waitFor(() => expect(launches).toHaveLength(2))

      const second = launches[1]
      if (!second) throw new Error('missing annotation turn')
      expect(second.request.prompt).toContain(agentFb.id)
      expect(second.request.prompt).toContain('hero-title')
      expect(second.request.prompt).toContain('把标题改成「新标题」并发布新版')

      const runningReview = await listReview(artifactId)
      expect(runningReview.threads[humanFb.id]?.agent).toBeUndefined()
      expect(runningReview.threads[agentFb.id]?.agent?.state).toBe('running')

      // Agent 发布 v2 并回复正文。
      const tool = { Authorization: `Bearer ${second.request.token}` }
      const updated = await req(`/agent/tool/artifacts/${artifactId}`, 'PATCH', tool, {
        project: 'design',
        baseVersion: 1,
        edits: [{ old_str: '旧标题', new_str: '新标题' }],
      })
      expect(updated.status).toBe(200)
      second.resolve('已将主标题更新为「新标题」并发布 v2。')

      await vi.waitFor(async () => {
        const done = await listReview(artifactId)
        expect(done.threads[agentFb.id]?.agent?.state).toBe('published')
      })

      const finalReview = await listReview(artifactId)
      expect(finalReview.threads[humanFb.id]?.agent).toBeUndefined()
      expect(finalReview.threads[agentFb.id]?.agent).toMatchObject({
        state: 'published',
        reply: '已将主标题更新为「新标题」并发布 v2。',
        publications: [{ artifactId, version: 2 }],
      })
      expect(finalReview.items.find((item) => item.id === agentFb.id)?.status).toBe('resolved')
      expect(finalReview.items.find((item) => item.id === humanFb.id)?.status).toBe('pending')
    } finally {
      container.close()
    }
  },
)

it('评审草稿须提交本轮后才投递，忙碌时排队且撤回重提不重复投递，并区分仅回复与失败', async () => {
  const { container, launches, cli, browser, req, publishBoundArtifact, listReview } =
    createFixture(':memory:')
  try {
    const artifactId = await publishBoundArtifact()
    const roundRes = await req(`/artifacts/${artifactId}/rounds`, 'POST', cli, {
      project: 'design',
      groups: [{ id: 'g1', title: '视觉验收', kind: 'verify' }],
    })
    expect(roundRes.status).toBe(201)
    const { round } = (await roundRes.json()) as { round: { id: string } }

    // 草拟期间写 3 条草稿：1 条仅同事、2 条发给 Agent；均不得提前触发。
    const createDraft = async (audience: 'human' | 'agent', body: string) => {
      const res = await req(`/artifacts/${artifactId}/feedback`, 'POST', browser, {
        project: 'design',
        version: 1,
        roundId: round.id,
        kind: 'comment',
        audience,
        element: { blockId: 'hero-title' },
        body,
      })
      expect(res.status).toBe(201)
      return ((await res.json()) as { feedback: Feedback }).feedback
    }
    const humanDraft = await createDraft('human', '仅同事备忘')
    const firstAgentDraft = await createDraft('agent', '只需文字解释无需改版')
    const secondAgentDraft = await createDraft('agent', '第二条需排队执行')
    expect(launches).toHaveLength(1)

    // 提交轮次：仅两条 agent 草稿进入执行（第 1 条 running，第 2 条 queued）。
    expect(
      (await req(`/artifacts/${artifactId}/rounds/${round.id}/submit`, 'POST', browser, {})).status,
    ).toBe(200)
    await vi.waitFor(() => expect(launches).toHaveLength(2))

    const mid = await listReview(artifactId)
    expect(mid.threads[humanDraft.id]?.agent).toBeUndefined()
    expect(mid.threads[firstAgentDraft.id]?.agent?.state).toBe('running')
    expect(mid.threads[secondAgentDraft.id]?.agent?.state).toBe('queued')

    // 撤回并再次提交本轮，已投递/排队中的批注不得重复投递。
    expect(
      (await req(`/artifacts/${artifactId}/rounds/${round.id}/withdraw`, 'POST', browser, {}))
        .status,
    ).toBe(200)
    expect(
      (await req(`/artifacts/${artifactId}/rounds/${round.id}/submit`, 'POST', browser, {})).status,
    ).toBe(200)
    expect(launches).toHaveLength(2)

    // 第 1 条仅回复且不发布新版本 -> state 为 replied，随后自动出队执行第 2 条。
    launches[1]?.resolve('这里保持原样即可，因此未发布新版本。')
    await vi.waitFor(() => expect(launches).toHaveLength(3))

    const afterFirst = await listReview(artifactId)
    expect(afterFirst.threads[firstAgentDraft.id]?.agent).toMatchObject({
      state: 'replied',
      reply: '这里保持原样即可，因此未发布新版本。',
      publications: [],
    })
    expect(afterFirst.threads[secondAgentDraft.id]?.agent?.state).toBe('running')

    // 第 2 条执行失败 -> state 为 failed，且不误标为 resolved。
    launches[2]?.reject(new Error('cli crashed'))
    await vi.waitFor(async () => {
      const done = await listReview(artifactId)
      expect(done.threads[secondAgentDraft.id]?.agent?.state).toBe('failed')
    })
    const finalReview = await listReview(artifactId)
    expect(finalReview.threads[secondAgentDraft.id]?.agent?.error).toBeTruthy()
    expect(finalReview.items.find((item) => item.id === secondAgentDraft.id)?.status).toBe(
      'pending',
    )
  } finally {
    container.close()
  }
})

it('离线失败、访客拦截与未绑定制品的纯 MCP 收件回执相互隔离', async () => {
  const { container, launches, cli, browser, req, publishBoundArtifact, listReview } =
    createFixture('memory')
  try {
    const artifactId = await publishBoundArtifact()

    // 未认证访客不能创建反馈触发本机 Agent。
    expect(
      (
        await req(
          `/artifacts/${artifactId}/feedback`,
          'POST',
          {},
          {
            project: 'design',
            version: 1,
            kind: 'comment',
            audience: 'agent',
            body: '访客尝试触发',
          },
        )
      ).status,
    ).toBe(401)
    expect(launches).toHaveLength(1)

    // 断开 Codex 后投递，线程明确标记 failed，不冒充排队或送达。
    expect((await req('/agent/connections/design', 'DELETE', cli)).status).toBe(200)
    const offlineRes = await req(`/artifacts/${artifactId}/feedback`, 'POST', browser, {
      project: 'design',
      version: 1,
      kind: 'comment',
      audience: 'agent',
      body: '离线期间发给 Agent',
    })
    expect(offlineRes.status).toBe(201)
    const { feedback: offlineFb } = (await offlineRes.json()) as { feedback: Feedback }
    const offlineReview = await listReview(artifactId)
    expect(offlineReview.threads[offlineFb.id]?.agent).toMatchObject({
      state: 'failed',
      publications: [],
    })
    expect(offlineReview.threads[offlineFb.id]?.agent?.error).toContain('Codex 未连接')

    // 模拟 Daemon 重启后遗留的 running 记录：读列表时修复为 failed，不自动重发。
    await container.repositories.feedbacks.annotations.setAgentDelivery(offlineFb.id, {
      state: 'running',
      publications: [],
      updatedAt: '2026-11-26T00:00:00.000Z',
    })
    const reconciled = await listReview(artifactId)
    expect(reconciled.threads[offlineFb.id]?.agent?.state).toBe('failed')
    expect(reconciled.threads[offlineFb.id]?.agent?.error).toContain('未自动重发')
    expect(launches).toHaveLength(1)

    // 未绑定受管会话的制品走原有 MCP pull/ack：status 为 delivered，thread.agent 为空（单纯收件回执）。
    const plainRes = await req('/artifacts', 'POST', cli, {
      project: 'design',
      slug: 'mcp-only',
      title: '纯 MCP 作品',
      type: 'html',
      source: '<p>hello</p>',
    })
    expect(plainRes.status).toBe(201)
    const { artifact: plain } = (await plainRes.json()) as { artifact: { publicId: string } }
    const fbRes = await req(`/artifacts/${plain.publicId}/feedback`, 'POST', browser, {
      project: 'design',
      version: 1,
      kind: 'comment',
      audience: 'agent',
      body: '请外部 MCP 处理',
    })
    const { feedback: mcpFb } = (await fbRes.json()) as { feedback: Feedback }
    const pulled = (await (await req(`/feedback?id=${plain.publicId}`, 'GET', cli)).json()) as {
      receipt?: string
    }
    expect(pulled.receipt).toBeTruthy()
    expect((await req('/feedback/ack', 'POST', cli, { receipt: pulled.receipt })).status).toBe(200)
    const mcpReview = await listReview(plain.publicId)
    expect(mcpReview.items.find((item) => item.id === mcpFb.id)?.status).toBe('delivered')
    expect(mcpReview.threads[mcpFb.id]?.agent).toBeUndefined()
  } finally {
    container.close()
  }
})
