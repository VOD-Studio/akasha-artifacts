import { EventEmitter, once } from 'node:events'
import { expect, it } from 'vitest'
import { sqliteHub } from './sqlite-hub.js'

it('点名邀请只由指定账户接受；降权、退出组织和撤销立即反映在原会话、收藏与书签上', async () => {
  const { login, send, publish, invite, accept, provider, open } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const other = await login('other')
  const work = await publish(owner, 'invited-member', 'team')
  const grant = await invite(work.path, owner, { kind: 'member', login: 'member' }, 'edit')
  expect((await send(work.path, 'GET', member)).status).toBe(404)
  expect((await accept(grant)).status).toBe(401)
  expect((await accept(grant, other)).status).toBe(404)
  expect((await send(work.path, 'GET', other)).status).toBe(404)
  expect(await (await accept(grant, member)).json()).toMatchObject({ artifactId: work.id })
  const second = await open()
  const detail = () => second.send(work.path, 'GET', member)
  const edit = (baseVersion: number) =>
    second.send(work.path, 'PATCH', member, {
      baseVersion,
      edits: [{ old_str: '第一稿', new_str: '协作者修订' }],
    })
  expect((await edit(1)).status).toBe(200)
  expect(await (await detail()).json()).toMatchObject({
    version: { source: '<h1>协作者修订</h1>' },
  })
  expect((await send(`${work.path}/favorite`, 'PUT', member, { favorite: true })).status).toBe(200)
  const favorites = async () => (await second.send('/api/v1/favorites', 'GET', member)).json()
  const library = async () => (await second.send('/api/v1/artifacts', 'GET', member)).json()
  expect(await favorites()).toEqual({ artifactIds: [work.id] })
  expect(await library()).toMatchObject({
    artifacts: [expect.objectContaining({ publicId: work.id })],
  })
  const grantPath = `${work.path}/sharing/grants/${grant}`
  const discussion = { version: 2, kind: 'comment', body: '请调整字号', audience: 'human' }
  expect((await send(grantPath, 'PATCH', owner, { role: 'comment' })).status).toBe(200)
  expect((await send(`${work.path}/sharing`, 'GET', member)).status).toBe(404)
  expect((await send(grantPath, 'PATCH', member, { role: 'edit' })).status).toBe(404)
  expect((await edit(2)).status).toBe(403)
  expect((await second.send(`${work.path}/feedback`, 'POST', member, discussion)).status).toBe(201)
  expect(await (await send(`${work.path}/feedback`, 'GET', owner)).json()).toMatchObject({
    items: [expect.objectContaining({ body: discussion.body })],
  })
  expect((await send(grantPath, 'PATCH', owner, { role: 'view' })).status).toBe(200)
  expect((await second.send(`${work.path}/feedback`, 'POST', member, discussion)).status).toBe(403)
  expect((await detail()).status).toBe(200)
  provider.organization.delete('member')
  expect((await detail()).status).toBe(404)
  expect(await favorites()).toEqual({ artifactIds: [] })
  expect(await library()).toEqual({ artifacts: [] })
  provider.organization.add('member')
  expect((await detail()).status).toBe(200)
  expect((await send(grantPath, 'DELETE', owner)).status).toBe(200)
  expect((await detail()).status).toBe(404)
  expect((await accept(grant, member)).status).toBe(404)
})

it('仅本人同时撤掉旧公开可见性、已接受的邀请和已兑换的普通链接', async () => {
  const { login, publish, send, invite, accept, link } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const work = await publish(owner, 'only-me', 'public')
  expect((await send(work.path)).status).toBe(200)
  const external = await link(work.path, owner)
  const grant = await invite(work.path, owner, { kind: 'member', login: 'member' })
  expect((await accept(grant, member)).status).toBe(200)
  for (const cookie of [member, external.cookie])
    expect((await send(work.path, 'GET', cookie)).status).toBe(200)
  expect((await send(`${work.path}/sharing/only-me`, 'POST', owner, {})).status).toBe(200)
  for (const cookie of ['', member, external.cookie])
    expect((await send(work.path, 'GET', cookie)).status).toBe(404)
  expect((await send(external.url)).status).toBe(404)
  expect((await accept(grant, member)).status).toBe(404)
  expect(await (await send(`${work.path}/sharing`, 'GET', owner)).json()).toMatchObject({
    restricted: true,
    grants: [],
  })
  expect((await send(work.path, 'GET', owner)).status).toBe(200)
})

it('另一份会话切到仅本人后，不再签发尚在目录中查询的旧邀请；仍可重新邀请', async () => {
  const { login, publish, send, open, provider, invite, accept } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const work = await publish(owner, 'pending-invitation')
  const directory = new EventEmitter()
  const started = once(directory, 'started')
  const resume = once(directory, 'resume')
  const fetchIdentity = provider.oauth.fetch
  provider.oauth.fetch = async (input, init) => {
    if (new URL(new Request(input, init).url).pathname === '/users/member') {
      directory.emit('started')
      await resume
    }
    return fetchIdentity(input, init)
  }
  const peer = await open()
  const target = { kind: 'member', login: 'member' } as const
  const pending = peer.send(`${work.path}/invitations`, 'POST', owner, {
    target,
    role: 'edit',
    ttlSeconds: 300,
  })
  await started
  try {
    expect((await send(`${work.path}/sharing/only-me`, 'POST', owner, {})).status).toBe(200)
  } finally {
    directory.emit('resume')
  }
  expect((await pending).status).toBe(404)
  expect(await (await peer.send(`${work.path}/sharing`, 'GET', owner)).json()).toMatchObject({
    restricted: true,
    grants: [],
  })
  const fresh = await invite(work.path, owner, target, 'view')
  expect((await accept(fresh, member)).status).toBe(200)
})
