import type {
  AgentConversation,
  AgentConversationStatus,
  AgentReferencePreview,
  AgentReferenceScope,
} from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import { sessionFixture } from './agent-session-fixture.js'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwmnkGAAKYAZgAOdgfAAAAAElFTkSuQmCC'
const text = (value: string) => Buffer.from(value).toString('base64')

it('仅将本轮确认的图像与正文交付给授权会话，补充资料只关联真实新版', async () => {
  const { container, cli, browser, request, launch } = sessionFixture()
  const a = { projectId: 'studio', draftId: crypto.randomUUID() }
  const stage = async (scope: AgentReferenceScope, name: string, content: string) => {
    const result = await request('/agent/references', 'POST', browser, {
      scope,
      file: { name, content },
    })
    expect(result.status).toBe(201)
    return (await result.json()) as AgentReferencePreview
  }
  const post = (projectId: string, draftId: string, ids: string[]) =>
    request('/agent/design', 'POST', browser, {
      projectId,
      message: '根据参考设计',
      references: { draftId, ids },
    })
  try {
    for (const id of ['studio', 'elsewhere']) {
      await container.service.registerProject({ id, name: id, rootPath: `/tmp/${id}` })
      expect((await request('/agent/connections', 'POST', cli, { projectId: id })).status).toBe(200)
    }
    const visual = await stage(a, '色样.png', png)
    expect(visual.image).toBe(`data:image/png;base64,${png}`)
    const brief = await stage(a, '首版.md', text('标题 ORBIT-27'))
    expect(brief.text).toContain('ORBIT-27')
    const removed = await stage(a, '勿发.txt', text('REMOVED-SECRET'))
    expect(
      (await request('/agent/references', 'DELETE', browser, { scope: a, id: removed.id })).status,
    ).toBe(204)
    expect((await post('studio', a.draftId, [removed.id])).status).toBe(409)
    expect((await post('elsewhere', a.draftId, [brief.id])).status).toBe(409)
    expect((await post('studio', crypto.randomUUID(), [brief.id])).status).toBe(409)
    expect((await post('studio', a.draftId, [brief.id, removed.id])).status).toBe(409)
    expect((await post('studio', a.draftId, [brief.id, brief.id])).status).toBe(409)
    expect(launch).toHaveLength(0)
    const opened = await post('studio', a.draftId, [visual.id, brief.id])
    expect(opened.status).toBe(202)
    const session = (await opened.json()) as AgentConversation
    expect(session.turns[0]?.references?.map(({ name }) => name)).toEqual(['色样.png', '首版.md'])
    expect(JSON.stringify(session)).not.toContain('ORBIT-27')
    const first = launch[0]
    if (!first) throw new Error('未受理第一轮')
    expect(first.request.images?.map(({ bytes }) => Buffer.from(bytes).toString('base64'))).toEqual(
      [png],
    )
    expect(first.request.prompt).toContain('ORBIT-27')
    expect(first.request.prompt).not.toContain(png)
    expect(first.request.prompt).not.toContain('REMOVED-SECRET')
    const one = { Authorization: `Bearer ${first.request.token}` }
    expect(
      (
        await request('/agent/references', 'POST', one, {
          scope: a,
          file: { name: 'secret.txt', content: text('x') },
        })
      ).status,
    ).toBe(401)
    const written = await request('/agent/tool/artifacts', 'POST', one, {
      project: 'studio',
      type: 'artboard',
      slug: 'orbit',
      title: 'Orbit',
      source: JSON.stringify({
        boards: [{ id: 'cover', title: 'ORBIT-27', html: '<h1>ORBIT-27</h1>' }],
      }),
    })
    expect(written.status).toBe(201)
    const result = (await written.json()) as { artifact: { publicId: string } }
    const id = result.artifact.publicId
    const path = `/artifacts/${id}/agent-session`
    const current = async () =>
      (await (await request(path, 'GET', browser)).json()) as AgentConversationStatus
    first.reply('记录首版')
    await vi.waitFor(async () => expect((await current()).availability).toBe('ready'))
    expect((await post('studio', a.draftId, [brief.id])).status).toBe(409)
    const version1 = await container.service.getArtifact({ id, version: 1 })
    const b = { ...a, sessionId: session.id, draftId: crypto.randomUUID() }
    const revision = await stage(b, '修订.txt', text('LANTERN-93'))
    expect((await post('studio', b.draftId, [revision.id])).status).toBe(409)
    const continued = await request(path, 'POST', browser, {
      message: '采用新标题',
      references: { draftId: b.draftId, ids: [revision.id] },
    })
    expect(continued.status).toBe(202)
    const next = launch[1]
    if (!next) throw new Error('未受理补充轮次')
    expect(next.request.prompt).toContain('LANTERN-93')
    expect(next.request.prompt).not.toContain('ORBIT-27')
    expect(next.request.images).toEqual([])
    expect(
      (
        await request(
          `/agent/tool/artifacts/${id}`,
          'PATCH',
          { Authorization: `Bearer ${next.request.token}` },
          {
            project: 'studio',
            baseVersion: 1,
            edits: [{ old_str: '<h1>ORBIT-27</h1>', new_str: '<h1>LANTERN-93</h1>' }],
          },
        )
      ).status,
    ).toBe(200)
    next.reply('记录新版')
    await vi.waitFor(async () => expect((await current()).availability).toBe('ready'))
    expect((await container.service.getArtifact({ id, version: 1 })).version.source).toBe(
      version1.version.source,
    )
    expect((await container.service.getArtifact({ id, version: 2 })).version.source).toContain(
      '<h1>LANTERN-93</h1>',
    )
    const turns = (await current()).session?.turns
    expect(
      turns?.map(({ references, publications }) => [
        references?.map(({ name }) => name),
        publications.map(({ version }) => version),
      ]),
    ).toEqual([
      [['色样.png', '首版.md'], [1]],
      [['修订.txt'], [2]],
    ])
  } finally {
    container.close()
  }
})

it('拒绝未授权、篡改、超时或无法解析的材料，全部拒绝前不启动 CLI', async () => {
  const { container, cli, browser, request, launch } = sessionFixture()
  const scope = { projectId: 'studio', draftId: crypto.randomUUID() }
  const post = (file: unknown, headers: Record<string, string> = browser) =>
    request('/agent/references', 'POST', headers, { scope, file })
  const file = { name: '稿件.txt', content: text('可重试') }
  try {
    await container.service.registerProject({ id: 'studio', name: '设计', rootPath: '/tmp/studio' })
    expect((await post(file)).status).toBe(409)
    await request('/agent/connections', 'POST', cli, { projectId: 'studio' })
    expect((await post(file, {})).status).toBe(401)
    expect((await post(file, { ...browser, Origin: 'https://outside.example' })).status).toBe(403)
    expect((await post({ ...file, name: '../secret.txt' })).status).toBe(400)
    expect((await post({ url: 'https://outside.example/data', name: 'secret.txt' })).status).toBe(
      400,
    )
    expect((await post({ ...file, name: '不是演示.pptx' })).status).toBe(400)
    expect((await post({ ...file, content: 'A'.repeat(3 * 1024 * 1024) })).status).toBe(413)
    const staged = (await (await post(file)).json()) as AgentReferencePreview
    const submit = () =>
      request('/agent/design', 'POST', browser, {
        projectId: 'studio',
        message: '资料',
        references: { draftId: scope.draftId, ids: [staged.id] },
      })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(staged.expiresAt + 1000)
    expect((await submit()).status).toBe(409)
    vi.useRealTimers()
    const before = (await (await post(file)).json()) as AgentReferencePreview
    await request('/agent/connections/studio', 'DELETE', cli)
    await request('/agent/connections', 'POST', cli, { projectId: 'studio' })
    expect(
      (
        await request('/agent/design', 'POST', browser, {
          projectId: 'studio',
          message: '重连',
          references: { draftId: scope.draftId, ids: [before.id] },
        })
      ).status,
    ).toBe(409)
    expect(launch).toHaveLength(0)
  } finally {
    vi.useRealTimers()
    container.close()
  }
})
