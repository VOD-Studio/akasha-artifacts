import type { AgentConnection, AgentConversation, AgentConversationStatus } from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import type { AgentRunnerLaunch } from '../src/domain/agent-runner.js'

it('只续接实际发布该制品的 CLI 线程，不跨项目、不以发布回执冒充回复', async () => {
  const launch: { request: AgentRunnerLaunch; reply: (text: string) => void }[] = []
  const container = createLocalContainer({
    dbPath: 'memory',
    agentRunner: {
      check: async () => undefined,
      run: (request) =>
        new Promise<string>((reply) => {
          request.onThread(request.threadId ?? '29f7e3f3-cfe3-497e-a080-ee5fd08780ec')
          launch.push({ request, reply })
        }),
    },
  })
  const cli = { Authorization: `Bearer ${container.token}` }
  const browser = { Cookie: `akasha_session=${container.token}`, Origin: 'http://127.0.0.1:24321' }
  function request(path: string, method: string, headers: Record<string, string>, body?: unknown) {
    return container.app.request(`http://127.0.0.1:24321/api/v1${path}`, {
      method,
      headers: { Host: '127.0.0.1:24321', 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
  try {
    for (const id of ['design', 'other']) {
      expect(
        await request('/projects', 'POST', cli, { id, name: id, rootPath: `/tmp/${id}` }),
      ).toHaveProperty('status', 201)
    }
    const connect = { projectId: 'design' }
    expect((await request('/agent/connections', 'POST', browser, connect)).status).toBe(403)
    expect((await request('/agent/connections', 'POST', cli, connect)).status).toBe(200)
    expect((await request('/agent/connections', 'GET', {}, undefined)).status).toBe(401)
    const { connections } = (await (
      await request('/agent/connections', 'GET', browser)
    ).json()) as {
      connections: AgentConnection[]
    }
    expect(connections).toEqual([{ projectId: 'design', harness: 'codex', availability: 'ready' }])
    expect(
      (
        await request('/agent/design', 'POST', browser, {
          projectId: 'other',
          message: '另一个项目',
        })
      ).status,
    ).toBe(409)
    const opened = await request('/agent/design', 'POST', browser, {
      projectId: 'design',
      message: '制作预约页',
    })
    expect(opened.status).toBe(202)
    const session = (await opened.json()) as AgentConversation
    await vi.waitFor(() => expect(launch).toHaveLength(1))
    const first = launch[0]
    if (!first) throw new Error('未收到首发轮次')
    const tool = { Authorization: `Bearer ${first.request.token}` }
    const publish = {
      project: 'design',
      slug: 'booking',
      title: '预约',
      type: 'html',
      source: '<h1>预约</h1>',
    }
    expect(
      (await request('/agent/tool/artifacts', 'POST', tool, { ...publish, project: 'other' }))
        .status,
    ).toBe(403)
    expect((await request('/artifacts', 'POST', tool, publish)).status).toBe(401)
    const written = await request('/agent/tool/artifacts', 'POST', tool, publish)
    expect(written.status).toBe(201)
    const { artifact } = (await written.json()) as { artifact: { publicId: string } }
    const route = `/artifacts/${artifact.publicId}/agent-session`
    async function status() {
      const data = await request(route, 'GET', browser)
      expect(data.status).toBe(200)
      return (await data.json()) as AgentConversationStatus
    }
    const publishing = await status()
    expect(publishing.session?.id).toBe(session.id)
    expect(publishing.session?.turns[0]?.publications).toEqual([
      { artifactId: artifact.publicId, version: 1 },
    ])
    expect(publishing.session?.turns[0]?.reply).toBeUndefined()
    first.reply('已完成首版预约页。')
    await vi.waitFor(async () =>
      expect((await status()).session?.turns[0]?.reply).toBe('已完成首版预约页。'),
    )
    expect((await request(`/agent/tool/artifacts/${artifact.publicId}`, 'GET', tool)).status).toBe(
      401,
    )

    const message = {
      message: '缩短标题',
      target: {
        artifactId: artifact.publicId,
        projectId: 'design',
        version: 1,
        boardId: 'artifact',
        element: { blockId: 'heading', textPreview: '预约' },
      },
    }
    expect(
      (
        await request(route, 'POST', browser, {
          ...message,
          target: { ...message.target, projectId: 'other' },
        })
      ).status,
    ).toBe(403)
    expect((await request(route, 'POST', browser, message)).status).toBe(202)
    await vi.waitFor(() => expect(launch).toHaveLength(2))
    const second = launch[1]
    if (!second) throw new Error('未收到续接轮次')
    expect(second.request.threadId).toBe('29f7e3f3-cfe3-497e-a080-ee5fd08780ec')
    expect(second.request.prompt).toContain('heading')
    const secondTool = { Authorization: `Bearer ${second.request.token}` }
    const updated = await request(
      `/agent/tool/artifacts/${artifact.publicId}`,
      'PATCH',
      secondTool,
      {
        project: 'design',
        baseVersion: 1,
        edits: [{ old_str: '预约', new_str: '订位' }],
      },
    )
    expect(updated.status).toBe(200)
    second.reply('标题已改为订位。')
    await vi.waitFor(async () => {
      const turn = (await status()).session?.turns[1]
      expect(turn?.reply).toBe('标题已改为订位。')
      expect(turn?.publications).toEqual([{ artifactId: artifact.publicId, version: 2 }])
    })
    expect((await request('/agent/connections/design', 'DELETE', cli)).status).toBe(200)
    expect((await status()).availability).toBe('offline')
    expect((await request(route, 'POST', browser, message)).status).toBe(409)
    const replaced = await request('/projects', 'POST', cli, {
      id: 'design',
      name: '不同的实际项目',
      rootPath: '/tmp/replacement',
    })
    expect(replaced.status).toBe(201)
    expect((await request('/agent/connections', 'POST', cli, connect)).status).toBe(200)
    expect(await status()).toEqual({ availability: 'unbound' })
    expect((await request(route, 'POST', browser, message)).status).toBe(409)
    expect(launch).toHaveLength(2)
  } finally {
    container.close()
  }
})
