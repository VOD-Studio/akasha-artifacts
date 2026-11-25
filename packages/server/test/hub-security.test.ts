import {
  ArtifactAwaitFeedbackOutputSchema,
  ArtifactSchema,
  type ElementRef,
  FeedbackSchema,
  ReviewRoundSchema,
  VersionSchema,
} from '@akasha/protocol'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHubContainer, type HubContainerOptions } from '../src/app/create-hub-container.js'
import { createMemoryContainer } from '../src/app/create-memory-container.js'
import { RealtimeEventHub } from '../src/infrastructure/realtime/event-hub.js'
import { InMemoryArtifactStorage } from '../src/infrastructure/storage/memory/artifact-kv.js'
import { createSqliteHubStorage } from '../src/infrastructure/storage/sqlite/hub-storage.js'

const origin = 'https://hub.example.com'
const sandboxOrigin = 'https://preview.example.net'
const publishedArtifact = z.object({ artifact: ArtifactSchema, version: VersionSchema })

function setup(storage?: HubContainerOptions['repositories']) {
  let now = Date.parse('2026-11-23T10:00:00.000Z')
  const clock = { now: () => new Date(now).toISOString() }
  const repositories = storage ?? createMemoryContainer({ clock }).repositories
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
    if (url.pathname === '/user/emails')
      return Response.json([{ email: `${login}@example.test`, verified: true }])
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
  const callback = async (login: keyof typeof users, path = '/auth/login?next=%2Fworkbench') => {
    const begin = await send(path)
    expect(begin.status).toBe(302)
    const oauth = new URL(begin.headers.get('location') ?? '')
    expect(oauth.searchParams.get('scope')?.split(' ').sort()).toEqual(['read:org', 'user:email'])
    const state = oauth.searchParams.get('state')
    const cookie = begin.headers.get('set-cookie')?.split(';')[0] ?? ''
    return await send(
      `/auth/github/callback?state=${encodeURIComponent(state ?? '')}&code=${login}`,
      { headers: { cookie } },
    )
  }
  const login = async (login: keyof typeof users) => {
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
      expect(await response.json()).toMatchObject({
        user: { userId, member, kind: 'session', admin: false },
      })
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

  it('在同一所有者的两个项目间复制固定版和移动原件，并保留旧链接的访问边界', async ({
    onTestFinished,
  }) => {
    const storage = createSqliteHubStorage(':memory:')
    onTestFinished(storage.close)
    const { login, post, send } = setup(storage)
    const alice = await login('alice')
    const bob = await login('bob')
    async function register(id: string, cookie: string) {
      const response = await post(
        '/api/v1/projects',
        { id, name: id, rootPath: `/qa/${id}` },
        cookie,
      )
      expect(response.status).toBe(201)
      return z.object({ project: z.object({ id: z.string() }) }).parse(await response.json())
        .project.id
    }
    const from = await register('from', alice)
    const taken = await register('taken', alice)
    const destination = await register('destination', alice)
    const otherOwner = await register('other-owner', bob)
    const original = { slug: 'html/transfer', title: '原件', type: 'html', source: '<p>第一版</p>' }
    const create = async (project: string, cookie: string) => {
      const response = await post('/api/v1/artifacts', { ...original, project }, cookie)
      expect(response.status).toBe(201)
      return publishedArtifact.parse(await response.json()).artifact
    }
    const artifact = await create(from, alice)
    const existing = await create(taken, alice)
    const path = `/api/v1/artifacts/${artifact.publicId}`
    expect(
      (
        await post(
          '/api/v1/artifacts',
          { ...original, project: from, baseVersion: 1, source: '<p>第二版</p>' },
          alice,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await post(
          `${path}/feedback`,
          { version: 1, kind: 'comment', audience: 'human', body: '跟随原件的讨论' },
          alice,
        )
      ).status,
    ).toBe(201)
    const signed = await post(
      `${path}/share`,
      { role: 'view', entry: { kind: 'version', version: 1 } },
      alice,
    )
    const { url } = z.object({ url: z.string() }).parse(await signed.json())
    const grant = (await send(url)).headers.get('set-cookie')?.split(';')[0]
    expect(grant).toBeTruthy()
    const transfer = (input: object, cookie = alice) => post(`${path}/transfer`, input, cookie)
    expect((await transfer({ kind: 'move', targetProjectId: taken })).status).toBe(409)
    expect((await transfer({ kind: 'move', targetProjectId: otherOwner })).status).toBe(403)
    expect(
      (
        await transfer(
          { kind: 'copy', targetProjectId: destination, version: 1, slug: original.slug },
          grant,
        )
      ).status,
    ).toBe(403)

    const cloneSlug = 'html/reproduction'
    const created = await transfer({
      kind: 'copy',
      targetProjectId: destination,
      version: 1,
      slug: cloneSlug,
    })
    expect(created.status).toBe(201)
    const clone = publishedArtifact.parse(await created.json())
    expect(clone.artifact).toMatchObject({
      projectId: destination,
      slug: cloneSlug,
      visibility: 'private',
      headVersion: 1,
    })
    expect(clone.artifact.publicId).not.toBe(artifact.publicId)
    expect(clone.version.source).toBe(original.source)
    const copyPath = `/api/v1/artifacts/${clone.artifact.publicId}`
    expect(
      await (await send(`${copyPath}/feedback`, { headers: { cookie: alice } })).json(),
    ).toEqual({ items: [], threads: {} })
    expect((await send(copyPath, { headers: { cookie: grant ?? '' } })).status).toBe(404)

    const moved = await transfer({ kind: 'move', targetProjectId: destination })
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({
      artifact: { publicId: artifact.publicId, projectId: destination, headVersion: 2 },
    })
    const after = await send(`${path}?version=1`, { headers: { cookie: grant ?? '' } })
    expect(await after.json()).toMatchObject({ version: { source: original.source, version: 1 } })
    expect(
      await (await send(`${path}/feedback`, { headers: { cookie: alice } })).json(),
    ).toMatchObject({ items: [{ body: '跟随原件的讨论' }] })
    expect(
      (await send(`${path}?projectId=${encodeURIComponent(from)}`, { headers: { cookie: alice } }))
        .status,
    ).toBe(404)
    expect(
      (
        await send(`${path}?projectId=${encodeURIComponent(destination)}`, {
          headers: { cookie: alice },
        })
      ).status,
    ).toBe(200)
    expect(
      (await send(`/api/v1/artifacts/${existing.publicId}`, { headers: { cookie: alice } })).status,
    ).toBe(200)
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
    const teamPath = `/api/v1/artifacts/${team.artifact.publicId}`
    const rename = (cookie: string) =>
      send(`${teamPath}/metadata`, {
        method: 'PATCH',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ title: '协作展示名' }),
      })
    expect(
      await (await send(`${teamPath}/management`, { headers: { cookie: bob } })).json(),
    ).toEqual({ canManage: false })
    expect((await rename(bob)).status).toBe(403)
    expect(await (await rename(alice)).json()).toMatchObject({
      artifact: { publicId: team.artifact.publicId, title: '协作展示名', headVersion: 2 },
    })
    expect(
      await (await send(`${teamPath}?version=2`, { headers: { cookie: bob } })).json(),
    ).toMatchObject({
      artifact: { title: '协作展示名' },
      version: { title: '团队更新', version: 2 },
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

    const favorite = (cookie: string, value: boolean) =>
      send(`${teamPath}/favorite`, {
        method: 'PUT',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ favorite: value }),
      })
    const listFavorites = (cookie: string) => send('/api/v1/favorites', { headers: { cookie } })
    expect((await listFavorites('')).status).toBe(401)
    expect((await favorite(bob, true)).status).toBe(200)
    expect(await (await listFavorites(bob)).json()).toEqual({
      artifactIds: [team.artifact.publicId],
    })
    expect(await (await listFavorites(alice)).json()).toEqual({ artifactIds: [] })
    expect((await favorite(bob, false)).status).toBe(200)
    expect(await (await listFavorites(bob)).json()).toEqual({ artifactIds: [] })

    const data = { label: '仅公用尺寸' }
    expect(
      (
        await post(
          storage,
          { action: 'set', scope: 'shared', key: 'label', value: data.label },
          alice,
        )
      ).status,
    ).toBe(200)
    const usage = await send(`${storage}/usage`, { headers: { cookie: alice } })
    expect(await usage.json()).toEqual({
      sharedBytes: new TextEncoder().encode(JSON.stringify(data)).length,
      privateBytes: 0,
      limitPerScopeBytes: 64 * 1024,
    })
    expect((await send(`${storage}/usage`, { headers: { cookie: bob } })).status).toBe(403)
  })

  it('分享链接限定制品，只供讨论的批注不进入回执，回执仅项目所有者可消费', async ({
    onTestFinished,
  }) => {
    const storage = createSqliteHubStorage(':memory:')
    onTestFinished(storage.close)
    const { hub, request, send, post, login, advance } = setup(storage)
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
    expect(redeemed.headers.get('location')).toBe(`/a/${id}?shared=1`)
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
    const roundResponse = await post(
      `${path}/rounds`,
      { groups: [{ id: 'choice', title: '布局', kind: 'choose', options: ['A', 'B'] }] },
      alice,
    )
    expect(roundResponse.status).toBe(201)
    const { round } = z.object({ round: ReviewRoundSchema }).parse(await roundResponse.json())
    const anchor = {
      version: 1,
      kind: 'comment',
      element: { blockId: 'heading' },
    }
    const reviewPath = `${path}/feedback?includeDrafts=true`
    const discussion = await post(
      `${path}/feedback`,
      { ...anchor, body: '只供讨论', audience: 'human' },
      cookie,
    )
    expect(discussion.status).toBe(201)
    const { feedback: humanRoot } = z
      .object({ feedback: FeedbackSchema })
      .parse(await discussion.json())
    const threadPath = `${path}/feedback/${humanRoot.id}`
    expect(
      (
        await post(
          `${path}/feedback`,
          { ...anchor, body: '访客无权投递', audience: 'agent' },
          cookie,
        )
      ).status,
    ).toBe(403)
    const submitted = await post(
      `${path}/feedback`,
      { ...anchor, roundId: round.id, body: '离线意见', audience: 'agent' },
      alice,
    )
    expect(submitted.status).toBe(201)
    const { feedback: agentRoot } = z
      .object({ feedback: FeedbackSchema })
      .parse(await submitted.json())
    expect(
      (
        await post(
          `${path}/feedback/${agentRoot.id}/replies`,
          { body: '不能读取草稿', includeDrafts: true },
          cookie,
        )
      ).status,
    ).toBe(404)
    expect((await post(`${threadPath}/replies`, { body: '作者回复' }, alice)).status).toBe(201)
    const preflight = await send(`/api/v1/feedback?id=${id}&includeDrafts=true`, {
      headers: { cookie: alice },
    })
    expect(await preflight.json()).toMatchObject({ items: [], cursor: '' })
    const shareDrafts = await send(reviewPath, { headers: { cookie } })
    expect(await shareDrafts.json()).toMatchObject({ items: [{ id: humanRoot.id }] })
    expect((await post(`${path}/rounds/${round.id}/submit`, {}, alice)).status).toBe(200)
    advance(1)
    expect(
      (
        await post(
          `${threadPath}/replies`,
          { body: '分享审阅回复', author: 'human:forged' },
          cookie,
        )
      ).status,
    ).toBe(201)
    expect((await post(`${threadPath}/resolve`, { resolved: true }, bob)).status).toBe(404)
    expect((await post(`${threadPath}/resolve`, { resolved: true }, alice)).status).toBe(200)
    const review = await send(reviewPath, { headers: { cookie } })
    expect(review.headers.get('cache-control')).toBe('private, no-store')
    expect(await review.json()).toMatchObject({
      items: [{ body: '只供讨论', draft: false }],
      threads: {
        [humanRoot.id]: {
          replies: [{ body: '作者回复' }, { body: '分享审阅回复', author: 'human:share' }],
          resolution: { resolvedAt: expect.any(String) },
        },
      },
    })
    expect((await send(reviewPath, { headers: { cookie: bob } })).status).toBe(404)
    expect((await post(`${threadPath}/resolve`, { resolved: false }, alice)).status).toBe(200)
    expect(await (await send(reviewPath, { headers: { cookie: alice } })).json()).toMatchObject({
      threads: { [humanRoot.id]: { resolution: null } },
    })
    const pull = await post('/api/v1/feedback/await', { id, timeoutSec: 1 }, alice)
    expect(pull.status).toBe(200)
    const delivered = ArtifactAwaitFeedbackOutputSchema.parse(await pull.json())
    expect(delivered).toMatchObject({
      status: 'received',
      items: [{ body: '离线意见', author: 'human:github-101' }],
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

  it('独立画板读取不会扩大固定版分享的访问范围', async () => {
    const { send, post, login, advance } = setup()
    const owner = await login('alice')
    const payload = {
      slug: 'artboard/versioned',
      title: '固定版画板',
      type: 'artboard',
    }
    const publish = (html: string, baseVersion?: number) =>
      post(
        '/api/v1/artifacts',
        {
          ...payload,
          baseVersion,
          source: JSON.stringify({ boards: [{ id: 'checkout/v1', title: '结账', html }] }),
        },
        owner,
      )
    const { artifact } = publishedArtifact.parse(await (await publish('<h1>原版</h1>')).json())
    const path = `/api/v1/artifacts/${artifact.publicId}`
    const board = (version: number) => `${path}/boards?version=${version}&boardId=checkout%2Fv1`
    const entry = { kind: 'play', version: 1, pageId: '', boardId: 'checkout/v1' }
    const share = await post(`${path}/share`, { role: 'view', entry, ttlSeconds: 30 }, owner)
    expect(share.status).toBe(201)
    const { url } = z.object({ url: z.string() }).parse(await share.json())
    const redemption = await send(url)
    const headers = { cookie: redemption.headers.get('set-cookie')?.split(';')[0] ?? '' }
    expect((await publish('<h1>新版</h1>', 1)).status).toBe(200)

    expect((await send(board(1))).status).toBe(404)
    expect((await send(board(2), { headers })).status).toBe(404)
    expect((await send(`${path}/boards/checkout%2Fv1?version=1`, { headers })).status).toBe(404)
    expect((await send(`${path}?view=canvas&version=2`, { headers })).status).toBe(404)
    const detail = z
      .object({
        artifact: z.unknown(),
        version: z.unknown(),
        canvas: z.unknown(),
      })
      .parse(await (await send(`${path}?view=canvas`, { headers })).json())
    expect(detail).toMatchObject({
      artifact: { headVersion: 1 },
      version: { version: 1 },
      canvas: { boards: [{ id: 'checkout/v1' }] },
    })
    expect(detail.version).not.toHaveProperty('source')
    const history = z
      .object({ versions: z.array(z.unknown()) })
      .parse(await (await send(`${path}/versions?view=metadata`, { headers })).json())
    expect(history.versions).toEqual([expect.objectContaining({ version: 1 })])
    const fixed = await send(board(1), { headers })
    expect(await fixed.json()).toMatchObject({ version: 1, board: { html: '<h1>原版</h1>' } })
    expect(fixed.headers.get('cache-control')).toBe('private, no-store')
    advance(31)
    expect((await send(board(1), { headers })).status).toBe(404)
  })

  it('固定版分享只为可见历史批注读取一次对应原稿', async () => {
    const { repositories } = createMemoryContainer()
    const { send, post, login } = setup(repositories)
    const owner = await login('alice')
    const payload = {
      slug: 'artboard/annotation-scope',
      type: 'artboard',
      title: '历史批注分享',
      source: JSON.stringify({
        boards: [{ id: 'scope', title: '画板', html: '<h1 data-ak-block="heading">标题</h1>' }],
      }),
    }
    const { artifact } = publishedArtifact.parse(
      await (await post('/api/v1/artifacts', payload, owner)).json(),
    )
    const path = `/api/v1/artifacts/${artifact.publicId}`
    const share = await post(
      `${path}/share`,
      { role: 'view', entry: { kind: 'version', version: 1 }, ttlSeconds: 30 },
      owner,
    )
    expect(share.status).toBe(201)
    const { url } = z.object({ url: z.string() }).parse(await share.json())
    const redemption = await send(url)
    const headers = { cookie: redemption.headers.get('set-cookie')?.split(';')[0] ?? '' }
    expect((await post('/api/v1/artifacts', { ...payload, baseVersion: 1 }, owner)).status).toBe(
      200,
    )

    const feedbackPath = `${path}/feedback`
    const comment = async (version: number, element: ElementRef, audience = 'human') => {
      const response = await post(
        feedbackPath,
        { version, kind: 'comment', audience, element, body: '批注' },
        owner,
      )
      expect(response.status).toBe(201)
    }
    await comment(2, { blockId: 'heading' })
    await comment(1, { blockId: 'agent-only' }, 'agent')
    const scoped = { boardId: 'scope', selector: 'h1' }
    await comment(1, scoped)
    const sourceReads = vi.spyOn(repositories.artifacts, 'getVersion')
    const review = async () => {
      const response = await send(feedbackPath, { headers })
      expect(response.status).toBe(200)
      return z.object({ items: z.array(FeedbackSchema) }).parse(await response.json()).items
    }
    expect((await review()).map(({ element }) => element)).toEqual([scoped])
    expect(sourceReads).not.toHaveBeenCalled()

    await comment(1, { blockId: 'heading' })
    await comment(1, { blockId: 'scope' })
    sourceReads.mockClear()
    const items = await review()
    expect(items.map(({ version, element }) => [version, element])).toEqual(
      expect.arrayContaining([
        [1, scoped],
        [1, { boardId: 'scope', blockId: 'heading' }],
        [1, { boardId: 'scope', blockId: 'scope' }],
      ]),
    )
    expect(items).toHaveLength(3)
    expect(await review()).toEqual(items)
    expect(sourceReads.mock.calls).toEqual([[artifact.publicId, 1]])
  })

  it('按签名角色和固定版本隔离分享读取、讨论、编辑和实时事件', async () => {
    const { hub, request, send, post, login, advance } = setup()
    const owner = await login('alice')
    const payload = {
      slug: 'html/scoped',
      title: '签名分享',
      type: 'html',
      source: '<h1>原版</h1>',
    }
    const { artifact } = publishedArtifact.parse(
      await (await post('/api/v1/artifacts', payload, owner)).json(),
    )
    const path = `/api/v1/artifacts/${artifact.publicId}`
    const mint = async (role: string, entry: object) => {
      const created = await post(`${path}/share`, { role, entry, ttlSeconds: 30 }, owner)
      expect(created.status).toBe(201)
      const { url } = z.object({ url: z.string() }).parse(await created.json())
      const response = await send(url)
      expect(response.status).toBe(302)
      return {
        url,
        cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
        location: response.headers.get('location'),
      }
    }
    const view = await mint('view', { kind: 'play', version: 1, pageId: '', boardId: 'main' })
    const comment = await mint('comment', { kind: 'version', version: 1 })
    const edit = await mint('edit', { kind: 'artifact' })
    expect(view.location).toBe(`/a/${artifact.publicId}/v/1?shared=1#page=&board=main&play=1`)
    expect(comment.location).toBe(`/a/${artifact.publicId}/v/1?shared=1`)
    expect(edit.location).toBe(`/a/${artifact.publicId}?shared=1`)
    expect(
      (
        await post(
          '/api/v1/artifacts',
          { ...payload, baseVersion: 1, source: '<h1>新版</h1>' },
          owner,
        )
      ).status,
    ).toBe(200)
    expect((await send(path)).status).toBe(404)

    const fixedHeaders = { cookie: view.cookie }
    const shown = await send(path, { headers: fixedHeaders })
    expect(await shown.json()).toMatchObject({
      artifact: { headVersion: 1 },
      version: { version: 1, source: '<h1>原版</h1>' },
      access: { role: 'view', version: 1 },
    })
    expect((await send(`${path}?version=2`, { headers: fixedHeaders })).status).toBe(404)
    const versions = await send(`${path}/versions`, { headers: fixedHeaders })
    const onlyFixed = z.object({ versions: z.array(VersionSchema) }).parse(await versions.json())
    expect(onlyFixed.versions.map((version) => version.version)).toEqual([1])
    expect((await send(`${path}/state`, { headers: fixedHeaders })).status).toBe(404)

    const root = { version: 1, kind: 'comment', body: '审阅意见', audience: 'human' }
    expect((await post(`${path}/feedback`, root, view.cookie)).status).toBe(403)
    expect((await post(`${path}/feedback`, { ...root, version: 2 }, comment.cookie)).status).toBe(
      404,
    )
    const added = await post(`${path}/feedback`, root, comment.cookie)
    expect(added.status).toBe(201)
    const { feedback } = z.object({ feedback: FeedbackSchema }).parse(await added.json())
    expect(
      (await post(`${path}/feedback/${feedback.id}/replies`, { body: '同意' }, comment.cookie))
        .status,
    ).toBe(201)
    expect(
      (await post(`${path}/feedback`, { ...root, audience: 'agent' }, edit.cookie)).status,
    ).toBe(403)
    expect(
      (await post(`${path}/share`, { role: 'edit', entry: { kind: 'artifact' } }, edit.cookie))
        .status,
    ).toBe(403)
    const patch = (cookie: string, baseVersion: number) =>
      send(path, {
        method: 'PATCH',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ baseVersion, edits: [{ old_str: '新版', new_str: '已编辑' }] }),
      })
    expect((await patch(comment.cookie, 2)).status).toBe(403)
    expect((await patch(edit.cookie, 1)).status).toBe(409)
    expect((await patch(edit.cookie, 2)).status).toBe(200)
    const wholeSource = {
      ...payload,
      project: artifact.projectId,
      baseVersion: 3,
      title: '不能改制品元数据',
      source: '<h1>访客新设计</h1>',
    }
    expect((await post('/api/v1/artifacts', wholeSource, comment.cookie)).status).toBe(403)
    expect(
      (await post('/api/v1/artifacts', { ...wholeSource, visibility: 'public' }, edit.cookie))
        .status,
    ).toBe(403)
    expect((await post('/api/v1/artifacts', wholeSource, edit.cookie)).status).toBe(200)

    const edited = await send(path, { headers: { cookie: edit.cookie } })
    const { artifact: after, version } = publishedArtifact.parse(await edited.json())
    expect(after).toMatchObject({ title: payload.title, visibility: 'private' })
    expect(version).toMatchObject({ version: 4, source: wholeSource.source, author: 'human:share' })
    const scope = { artifactId: artifact.publicId }
    const subscriber = request(`/api/v1/ws?artifactId=${artifact.publicId}`, {
      headers: fixedHeaders,
    })
    const event = {
      v: 1 as const,
      seq: 1,
      timestamp: version.createdAt,
      type: 'version.created' as const,
      artifactId: artifact.publicId,
      version,
    }
    expect(await hub.authorizeRealtime(subscriber, scope)).toBe(true)
    expect(await hub.authorizeRealtimeEvent(subscriber, scope, event)).toBe(false)
    advance(31)
    expect((await send(view.url)).status).toBe(404)
    expect((await send(path, { headers: fixedHeaders })).status).toBe(404)
    expect(await hub.authorizeRealtime(subscriber, scope)).toBe(false)
  })

  it('撤下会失效旧签名和实时内容，授权恢复也不重新开放它们', async ({ onTestFinished }) => {
    const storage = createSqliteHubStorage(':memory:')
    onTestFinished(storage.close)
    const { hub, request, send, post, login } = setup(storage)
    const owner = await login('alice')
    const other = await login('bob')
    const payload = {
      slug: 'html/withdrawn',
      title: '保留的原件',
      type: 'html',
      source: '<p>原版</p>',
    }
    const { artifact, version } = publishedArtifact.parse(
      await (await post('/api/v1/artifacts', payload, owner)).json(),
    )
    const path = `/api/v1/artifacts/${artifact.publicId}`
    const pre = await post(
      `${path}/share`,
      { role: 'edit', entry: { kind: 'artifact' }, ttlSeconds: 3600 },
      owner,
    )
    const { url } = z.object({ url: z.string() }).parse(await pre.json())
    const shareCookie = (await send(url)).headers.get('set-cookie')?.split(';')[0] ?? ''
    const grant = { cookie: shareCookie, origin }
    expect((await send(path, { headers: grant })).status).toBe(200)
    expect((await send(path, { method: 'DELETE', headers: grant })).status).toBe(403)
    const scope = { artifactId: artifact.publicId }
    const subscription = request(`/api/v1/ws?artifactId=${artifact.publicId}`, { headers: grant })
    expect(await hub.authorizeRealtime(subscription, scope)).toBe(true)
    const deleteResponse = await send(path, {
      method: 'DELETE',
      headers: { cookie: owner, origin },
    })
    expect(deleteResponse.status).toBe(200)
    expect((await send(path, { headers: grant })).status).toBe(404)
    expect((await send(url)).status).toBe(404)
    expect(await hub.authorizeRealtime(subscription, scope)).toBe(false)
    const envelope = {
      v: 1 as const,
      seq: 3,
      artifactId: artifact.publicId,
      timestamp: version.createdAt,
    }
    expect(
      await hub.authorizeRealtimeEvent(subscription, scope, {
        ...envelope,
        type: 'version.created',
        version,
      }),
    ).toBe(false)
    expect(
      await hub.authorizeRealtimeEvent(subscription, scope, {
        ...envelope,
        type: 'artifact.metadata',
      }),
    ).toBe(true)
    expect(
      await (await send('/api/v1/withdrawn-artifacts', { headers: { cookie: other } })).json(),
    ).toEqual({ items: [] })
    expect((await post(`${path}/restore`, {}, other)).status).toBe(404)
    expect((await post(`${path}/restore`, {}, owner)).status).toBe(200)
    expect(await (await send(path, { headers: { cookie: owner } })).json()).toMatchObject({
      version,
    })
    expect((await send(url)).status).toBe(404)
    expect((await send(path, { headers: grant })).status).toBe(404)
    expect(
      await hub.authorizeRealtimeEvent(subscription, scope, {
        ...envelope,
        type: 'version.created',
        version,
      }),
    ).toBe(false)
    const next = await post(
      `${path}/share`,
      { role: 'view', entry: { kind: 'version', version: 1 } },
      owner,
    )
    const fresh = z.object({ url: z.string() }).parse(await next.json()).url
    expect((await send(fresh)).status).toBe(302)
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
