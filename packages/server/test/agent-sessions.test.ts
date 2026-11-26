import type { AgentConnection, AgentConversation, AgentConversationStatus } from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import { createLocalContainer } from '../src/app/create-local-container.js'
import { AgentSessions } from '../src/application/agent-sessions.js'
import type { AgentRunnerLaunch } from '../src/domain/agent-runner.js'
import { InMemoryArtifactStorage } from '../src/infrastructure/storage/memory/artifact-kv.js'
import { CryptoIdGenerator } from '../src/infrastructure/storage/memory/index.js'
import { sessionFixture } from './agent-session-fixture.js'

it('只续接实际发布该制品的 CLI 线程，不跨项目、不以发布回执冒充回复', async () => {
  const { container, launch, cli, browser, request } = sessionFixture()
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
    const status = async () => {
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

it('只在专用工具执行时提交所选参数一次，不以受理或助手回复代替回执', async () => {
  const { container, launch, cli, browser, request } = sessionFixture()
  const boards = ['x2', 'x3', 'x4'].map((id, i) => ({
    id,
    title: id.toUpperCase(),
    html: `<p>${id}</p>`,
    tweaks: [{ id: 'speed', type: 'number', label: '速度', min: 0, max: 10, default: i }],
  }))
  const publish = {
    project: 'design',
    slug: 'boards',
    title: '参数',
    type: 'artboard',
    source: JSON.stringify({ boards }),
  }
  const apply = '/agent/tool/apply-requested-tweaks'
  const tool = (index: number) => ({ Authorization: `Bearer ${launch[index]?.request.token}` })
  try {
    await container.service.registerProject({ id: 'design', rootPath: '/tmp/design', name: '设计' })
    expect((await request('/agent/connections', 'POST', cli, { projectId: 'design' })).status).toBe(
      200,
    )
    const design = { projectId: 'design', message: '制作画板' }
    const application = { boardId: 'x2', targetIds: ['x3'], values: { speed: 5 } }
    expect(
      (
        await request('/agent/design', 'POST', browser, {
          ...design,
          tweakApplication: application,
        })
      ).status,
    ).toBe(400)
    expect((await request('/agent/design', 'POST', browser, design)).status).toBe(202)
    expect((await request(apply, 'POST', tool(0), {})).status).toBe(403)
    const result = await request('/agent/tool/artifacts', 'POST', tool(0), publish)
    expect(result.status).toBe(201)
    const { artifact } = (await result.json()) as { artifact: { publicId: string } }
    const id = artifact.publicId
    const session = `/artifacts/${id}/agent-session`
    const current = async () =>
      (await (await request(session, 'GET', browser)).json()) as AgentConversationStatus
    const finish = async (index: number, reply: string) => {
      launch[index]?.reply(reply)
      await vi.waitFor(async () => expect((await current()).availability).toBe('ready'))
    }
    const head = () => container.service.getArtifact({ id, projectId: 'design' })
    const target = { artifactId: id, projectId: 'design', version: 1, boardId: 'x2' }
    const send = (changes = application, version = 1) =>
      request(session, 'POST', browser, {
        message: '采用参数',
        target: { ...target, version },
        tweakApplication: changes,
      })
    await finish(0, '首版')
    expect((await send({ ...application, boardId: 'x3' })).status).toBe(403)
    expect((await send({ ...application, targetIds: ['x3', 'missing'] })).status).toBe(400)
    expect((await send({ ...application, values: { speed: 1 } })).status).toBe(400)
    expect((await send()).status).toBe(202)
    await finish(1, '未调用工具')
    expect((await current()).session?.turns.at(-1)).toMatchObject({
      publications: [],
      reply: '未调用工具',
    })
    expect((await head()).version.version).toBe(1)

    expect((await send()).status).toBe(202)
    expect(launch[2]?.request.requestedTweaksOnly).toBe(true)
    expect((await request(apply, 'POST', browser, {})).status).toBe(403)
    expect((await request(apply, 'POST', tool(2), { baseVersion: 2 })).status).toBe(400)
    expect((await request('/agent/tool/artifacts', 'POST', tool(2), publish)).status).toBe(403)
    expect(
      (
        await request(`/agent/tool/artifacts/${id}`, 'PATCH', tool(2), {
          baseVersion: 1,
          edits: [{ old_str: 'x4', new_str: 'other' }],
        })
      ).status,
    ).toBe(403)
    const attempts = await Promise.all([
      request(apply, 'POST', tool(2), {}),
      request(apply, 'POST', tool(2), {}),
    ])
    expect(attempts.map(({ status }) => status).sort()).toEqual([200, 409])
    const receipt = { artifactId: id, version: 2, changed: [{ id: 'x3', title: 'X3' }] }
    expect(await attempts.find(({ status }) => status === 200)?.json()).toEqual(receipt)
    const stored = await head()
    expect(JSON.parse(stored.version.source).boards).toEqual([
      boards[0],
      { ...boards[1], tweaks: [{ ...boards[1]?.tweaks[0], default: 5 }] },
      boards[2],
    ])
    expect((await current()).session?.turns.at(-1)?.publications).toEqual([receipt])
    await finish(2, '已采用')
    expect((await send()).status).toBe(409)
    const next = { ...application, targetIds: ['x4'] }
    expect((await send(next, 2)).status).toBe(202)
    const userEdit = await container.service.update({
      id,
      projectId: 'design',
      baseVersion: 2,
      author: 'human:editor',
      source: publish.source,
    })
    expect((await request(apply, 'POST', tool(3), {})).status).toBe(409)
    await finish(3, '版本已变化')
    expect((await current()).session?.turns.at(-1)?.publications).toEqual([])
    expect((await head()).version).toEqual(userEdit.version)
    expect((await send(next, 3)).status).toBe(202)
    // 请求通过轮次鉴权后，在锁内读头版本与开始落库之间撤销授权。
    const repo = container.repositories.artifacts
    const getVersions = repo.getVersions.bind(repo)
    vi.spyOn(repo, 'getVersions').mockImplementationOnce(async (publicId) => {
      await request('/agent/connections/design', 'DELETE', cli)
      return getVersions(publicId)
    })
    expect((await request(apply, 'POST', tool(4), {})).status).toBe(401)
    expect((await request(apply, 'POST', tool(4), {})).status).toBe(401)
    launch[4]?.reply('已断开')
    expect((await head()).version).toEqual(userEdit.version)
  } finally {
    container.close()
  }
})

it('首版落库后会话日志不能再写时，重启仍按真实 v1 找回原发布会话', async () => {
  const container = createLocalContainer({ dbPath: 'memory' })
  const { projects, artifacts } = container.repositories
  const persisted = new InMemoryArtifactStorage()
  const write = persisted.compareAndSet.bind(persisted)
  vi.spyOn(persisted, 'compareAndSet').mockImplementation(async (key, revision, json) => {
    if (await artifacts.findBySlug('drafting', 'durable-first'))
      throw new Error('首版后无法写入会话日志')
    return write(key, revision, json)
  })
  let task: AgentRunnerLaunch | undefined
  const makeSessions = () =>
    new AgentSessions({
      ids: new CryptoIdGenerator(),
      store: persisted,
      projects,
      artifacts,
      service: container.service,
      baseUrl: () => 'http://127.0.0.1:24321',
      runner: {
        check: async () => undefined,
        run: (request) => {
          task = request
          request.onThread('e2ca1c56-6344-4432-a922-348fbe729545')
          return new Promise<string>((_resolve, reject) => {
            request.signal.addEventListener('abort', () => reject(request.signal.reason), {
              once: true,
            })
          })
        },
      },
    })
  const before = makeSessions()
  const recovered = makeSessions()
  try {
    await container.service.registerProject({
      id: 'drafting',
      name: '预约',
      rootPath: '/tmp/drafting',
    })
    await before.connect('drafting')
    const initial = await before.startDesign('drafting', '制作首版')
    if (!task) throw new Error('未启动 CLI 轮次')
    const { artifact, version } = await before.publish(task.token, {
      slug: 'durable-first',
      title: '预约',
      type: 'html',
      source: '<h1>有来源的首版</h1>',
    })
    expect(version.author).toBe(`agent:${initial.id}`)
    before.close()
    const status = await recovered.forArtifact(artifact.publicId)
    expect(status.availability).toBe('offline')
    expect(status.session?.id).toBe(initial.id)
    expect(status.session?.turns[0]).toMatchObject({
      status: 'failed',
      publications: [{ artifactId: artifact.publicId, version: 1 }],
    })
    expect((await recovered.conversation(initial.id)).artifactId).toBe(artifact.publicId)
  } finally {
    before.close()
    recovered.close()
    container.close()
  }
})
