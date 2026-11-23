import { ArtifactAwaitFeedbackOutputSchema, ArtifactSchema, VersionSchema } from '@akasha/protocol'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createHubContainer } from '../src/app/create-hub-container.js'
import { createMemoryContainer } from '../src/app/create-memory-container.js'
import { RealtimeEventHub } from '../src/infrastructure/realtime/event-hub.js'
import { InMemoryArtifactStorage } from '../src/infrastructure/storage/memory/artifact-kv.js'

const origin = 'https://hub.example.com'
const sandboxOrigin = 'https://preview.example.net'
const publishedArtifact = z.object({ artifact: ArtifactSchema, version: VersionSchema })

function setup() {
  let now = Date.parse('2026-11-23T10:00:00.000Z')
  const clock = { now: () => new Date(now).toISOString() }
  const { repositories } = createMemoryContainer({ clock })
  const realtime = new RealtimeEventHub({ clock })
  const users = { alice: 101, bob: 202, eve: 303 }
  const artifactStorage = new InMemoryArtifactStorage()
  const github: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    if (url.href === 'https://github.com/login/oauth/access_token') {
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      const body = JSON.parse(String(init?.body))
      expect(body.redirect_uri).toBe(`${origin}/auth/github/callback`)
      return Response.json({ access_token: body.code })
    }
    const login = new Headers(init?.headers).get('authorization')?.slice('Bearer '.length) ?? ''
    if (url.host !== 'api.github.com' || !Object.hasOwn(users, login))
      return new Response(null, { status: 404 })
    if (url.pathname === '/user')
      return Response.json({ login, id: users[login as keyof typeof users] })
    if (url.pathname === '/user/memberships/orgs/studio') return Response.json({ state: 'active' })
    if (url.pathname === `/orgs/studio/teams/design/memberships/${login}`) {
      return Response.json({ state: login === 'bob' ? 'active' : 'pending' })
    }
    throw new Error(`意外的 GitHub 请求: ${url}`)
  }
  const makeHub = () =>
    createHubContainer({
      repositories,
      realtime,
      clock,
      origin,
      sandboxOrigin,
      artifactStorage,
      oauth: {
        clientId: 'oauth-app-id',
        clientSecret: 'test-client-secret',
        signingSecret: 'test-signing-secret-for-hub-tests-only',
        organization: 'studio',
        team: 'design',
        allowlist: ['ALICE'],
        fetch: github,
      },
    })
  const hub = makeHub()
  const request = (path: string, init?: RequestInit) => new Request(new URL(path, origin), init)
  const send = (path: string, init?: RequestInit) => hub.app.fetch(request(path, init))
  const post = (path: string, body: unknown, cookie?: string) =>
    send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie, origin } : {}) },
      body: JSON.stringify(body),
    })
  async function callback(login: keyof typeof users, path = '/auth/login?next=%2Fworkbench') {
    const begin = await send(path)
    expect(begin.status).toBe(302)
    const oauth = new URL(begin.headers.get('location') ?? '')
    expect(oauth.searchParams.get('scope')).toBe('read:org')
    const state = oauth.searchParams.get('state')
    const cookie = begin.headers.get('set-cookie')?.split(';')[0] ?? ''
    return await send(
      `/auth/github/callback?state=${encodeURIComponent(state ?? '')}&code=${login}`,
      { headers: { cookie } },
    )
  }
  async function login(login: keyof typeof users) {
    const result = await callback(login)
    expect(result.status).toBe(302)
    expect(result.headers.get('location')).toBe('/workbench')
    const session = result.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-akasha_hub_session='))
    expect(session).toContain('Secure; HttpOnly; SameSite=Lax')
    return session?.split(';')[0] ?? ''
  }
  return {
    hub,
    makeHub,
    request,
    send,
    post,
    callback,
    login,
    advance: (seconds: number) => {
      now += seconds * 1000
    },
  }
}

describe('Cloud Hub 身份与制品权限', () => {
  it('验证 OAuth state、团队成员与本站写请求，且不允许开放重定向', async () => {
    const { send, post, callback, login } = setup()
    expect((await send('/auth/github/callback?state=unbound&code=alice')).status).toBe(400)
    expect(
      (await callback('alice', '/auth/login?next=%2F%2Fevil.example')).headers.get('location'),
    ).toBe('/')
    const alice = await login('alice')
    const bob = await login('bob')
    const eve = await login('eve')
    for (const [cookie, userId, member] of [
      [alice, '101', true],
      [bob, '202', true],
      [eve, '303', false],
    ] as const) {
      const response = await send('/api/v1/auth/session', { headers: { cookie } })
      expect(await response.json()).toMatchObject({ user: { userId, member, kind: 'session' } })
    }
    expect(
      (
        await send('/api/v1/auth/logout', {
          method: 'POST',
          headers: { origin: sandboxOrigin, cookie: alice },
        })
      ).status,
    ).toBe(403)
    expect(
      (await send('/api/v1/auth/session', { headers: { origin: sandboxOrigin, cookie: alice } }))
        .status,
    ).toBe(403)
    expect(
      (
        await send('/%61pi/v1/auth/session', {
          headers: { 'sec-fetch-site': 'cross-site', cookie: alice },
        })
      ).status,
    ).toBe(403)
    expect(
      (await post('/api/v1/projects', { name: '团队项目', rootPath: '/project' }, eve)).status,
    ).toBe(403)
    expect((await post('/api/v1/daemon/shutdown', {}, alice)).status).toBe(404)
  })

  it('隔离私有历史、状态、列表、选区与项目事件，只允许团队协作者编辑团队制品', async () => {
    const { hub, request, send, post, login } = setup()
    hub.app.get('/api/v1/ws', (c) => c.json({ ok: true }))
    const alice = await login('alice')
    const bob = await login('bob')
    const eve = await login('eve')
    const publish = async (visibility: 'private' | 'team' | 'public') => {
      const response = await post(
        '/api/v1/artifacts',
        {
          slug: `markdown/${visibility}`,
          title: visibility,
          type: 'markdown',
          source: '# 示例',
          visibility,
          author: 'human:github-202',
        },
        alice,
      )
      expect(response.status).toBe(201)
      return publishedArtifact.parse(await response.json())
    }
    const hidden = await publish('private')
    const team = await publish('team')
    const open = await publish('public')
    expect(hidden.version.author).toBe('human:github-101')
    const id: string = hidden.artifact.publicId
    const projectId: string = hidden.artifact.projectId
    const path = `/api/v1/artifacts/${id}`
    for (const cookie of [bob, eve, '']) {
      for (const suffix of ['', '?version=1', '/versions', '/state', '/visual-edit']) {
        expect((await send(`${path}${suffix}`, { headers: { cookie } })).status).toBe(404)
      }
      expect((await send(`/api/v1/feedback?id=${id}`, { headers: { cookie } })).status).toBe(404)
      expect(
        (
          await send(`/api/v1/projects/${encodeURIComponent(projectId)}/selection`, {
            headers: { cookie },
          })
        ).status,
      ).toBe(404)
      const list = await send('/api/v1/artifacts', { headers: { cookie } })
      expect(await list.json()).toMatchObject({
        artifacts: expect.not.arrayContaining([expect.objectContaining({ publicId: id })]),
      })
    }
    expect((await send(`/api/v1/artifacts/${open.artifact.publicId}`)).status).toBe(200)
    expect(
      (await send(`/api/v1/artifacts/${team.artifact.publicId}`, { headers: { cookie: eve } }))
        .status,
    ).toBe(404)
    const bobRequest = request('/api/v1/ws', { headers: { cookie: bob } })
    expect(
      (
        await send('/api/v1/ws', {
          headers: { cookie: bob, upgrade: 'websocket', origin: sandboxOrigin },
        })
      ).status,
    ).toBe(403)
    expect(await hub.authorizeRealtime(bobRequest, { artifactId: id, projectId })).toBe(false)
    expect(await hub.authorizeRealtime(bobRequest, { projectId })).toBe(true)
    expect(await hub.authorizeRealtime(bobRequest, { projectId: 'another-project' })).toBe(false)
    expect(
      await hub.authorizeRealtime(bobRequest, {
        artifactId: team.artifact.publicId,
        projectId: 'another-project',
      }),
    ).toBe(false)
    expect(
      await hub.authorizeRealtimeEvent(
        bobRequest,
        { projectId },
        {
          v: 1,
          seq: 1,
          timestamp: '2026-11-23T10:00:00.000Z',
          type: 'version.created',
          artifactId: id,
          version: hidden.version,
        },
      ),
    ).toBe(false)
    expect((await post(`${path}/visual-edit`, {}, bob)).status).toBe(404)
    expect(
      (await post(`/api/v1/artifacts/${open.artifact.publicId}/state`, { patch: [] }, bob)).status,
    ).toBe(403)
    expect(
      (
        await post(
          `/api/v1/artifacts/${team.artifact.publicId}/state`,
          { patch: [{ op: 'add', path: '/reviewing', value: true }] },
          bob,
        )
      ).status,
    ).toBe(200)
    const revision = {
      slug: team.artifact.slug,
      project: projectId,
      title: '团队更新',
      type: 'markdown',
      source: '# 团队更新',
      baseVersion: 1,
    }
    expect(
      (await post('/api/v1/artifacts', { ...revision, visibility: 'public' }, bob)).status,
    ).toBe(403)
    const republished = await post('/api/v1/artifacts', revision, bob)
    expect(republished.status).toBe(200)
    expect(await republished.json()).toMatchObject({
      version: { author: 'human:github-202', version: 2 },
      artifact: { visibility: 'team' },
    })
    const storage = `/api/v1/artifacts/${open.artifact.publicId}/storage`
    expect(
      (await post(storage, { action: 'set', scope: 'shared', key: 'flag', value: true }, bob))
        .status,
    ).toBe(403)
    expect(
      (await post(storage, { action: 'set', scope: 'private', key: 'flag', value: true }, bob))
        .status,
    ).toBe(200)
    const privateRead = await post(storage, { action: 'get', scope: 'private', key: 'flag' }, bob)
    expect(await privateRead.json()).toEqual({ value: true })
    expect((await post(storage, { action: 'get', scope: 'private', key: 'flag' })).status).toBe(401)
  })

  it('分享链接仅授权指定制品并可持久提交反馈，回执只可由制品所有者消费', async () => {
    const { hub, request, send, post, login, advance } = setup()
    const alice = await login('alice')
    const bob = await login('bob')
    const publish = await post(
      '/api/v1/artifacts',
      { slug: 'markdown/feedback', title: '待反馈', type: 'markdown', source: '# 待反馈' },
      alice,
    )
    const { artifact } = publishedArtifact.parse(await publish.json())
    const id: string = artifact.publicId
    const path = `/api/v1/artifacts/${id}`
    const share = await post(`${path}/share`, { ttlSeconds: 60 }, alice)
    expect(share.status).toBe(201)
    const { url } = z.object({ url: z.string() }).parse(await share.json())
    const redeemed = await send(url)
    expect(redeemed.headers.get('location')).toBe(`/a/${id}`)
    const cookie = redeemed.headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(await hub.authorizeArtifact(request(path, { headers: { cookie } }), id, 'read')).toBe(
      true,
    )
    expect(await hub.authorizeArtifact(request(path, { headers: { cookie } }), id, 'write')).toBe(
      false,
    )
    const other = await post(
      '/api/v1/artifacts',
      { slug: 'markdown/hidden', title: '其他制品', type: 'markdown', source: '# 私有' },
      alice,
    )
    expect(other.status).toBe(201)
    const { artifact: otherArtifact } = publishedArtifact.parse(await other.json())
    expect(
      (await send(`/api/v1/artifacts/${otherArtifact.publicId}`, { headers: { cookie } })).status,
    ).toBe(404)
    const feedback = await post(
      `${path}/feedback`,
      { version: 1, kind: 'comment', body: '离线意见' },
      cookie,
    )
    expect(feedback.status).toBe(201)
    const pull = await post('/api/v1/feedback/await', { id, timeoutSec: 1 }, alice)
    expect(pull.status).toBe(200)
    const delivered = ArtifactAwaitFeedbackOutputSchema.parse(await pull.json())
    expect(delivered).toMatchObject({
      status: 'received',
      items: [{ body: '离线意见', author: 'human:share' }],
      cursor: expect.any(String),
      receipt: expect.any(String),
    })
    expect((await post('/api/v1/feedback/ack', { receipt: delivered.receipt }, bob)).status).toBe(
      400,
    )
    const ack = await post('/api/v1/feedback/ack', { receipt: delivered.receipt }, alice)
    expect(await ack.json()).toMatchObject({ acknowledged: 1 })
    const resume = await send(
      `/api/v1/feedback?id=${id}&after=${encodeURIComponent(delivered.cursor)}`,
      { headers: { cookie: alice } },
    )
    expect(await resume.json()).toMatchObject({ items: [] })
    advance(61)
    expect((await send(path, { headers: { cookie } })).status).toBe(404)
    expect((await send(url)).status).toBe(404)
  })

  it('CLI 证明绑定一次性授权码，多实例只允许兑换一次', async () => {
    const { callback, makeHub, request } = setup()
    const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
    expect((await callback('eve', `/auth/cli?challenge=${challenge}`)).status).toBe(403)
    const response = await callback('alice', `/auth/cli?challenge=${challenge}`)
    expect(response.status).toBe(200)
    const code = (await response.text()).trim().split('\n').at(-1)
    const exchange = (proof: string) =>
      makeHub().app.fetch(
        request('/api/v1/auth/cli/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, verifier: proof }),
        }),
      )
    expect((await exchange('A'.repeat(43))).status).toBe(401)
    const both = await Promise.all([exchange(verifier), exchange(verifier)])
    expect(both.map((result) => result.status).sort()).toEqual([200, 401])
    const issued = z
      .object({ token: z.string(), expiresAt: z.string() })
      .parse(await both.find((result) => result.ok)?.json())
    expect(issued.expiresAt).toBe('2026-12-23T10:00:00.000Z')
    const principal = await makeHub().authenticate(
      request('/', { headers: { authorization: `Bearer ${issued.token}` } }),
    )
    expect(principal).toMatchObject({ login: 'alice', kind: 'cli', userId: '101' })
  })
})
