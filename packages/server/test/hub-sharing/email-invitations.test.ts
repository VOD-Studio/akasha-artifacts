import { expect, it } from 'vitest'
import { sqliteHub } from './sqlite-hub.js'

it('邮箱须经验证；接受后绑定一个账号，外部编辑者可以改稿但不能投递 Agent，原授权按时到期', async () => {
  const { login, send, publish, invite, accept, provider, advance } = await sqliteHub()
  const owner = await login('owner')
  const admin = await login('admin')
  const email = 'creative@example.net'
  const unverified = { email, primary: false, verified: false }
  const verified = { ...unverified, verified: true }
  provider.mailboxes.set('guest', [unverified])
  const guest = await login('guest')
  const other = await login('other')
  const work = await publish(owner, 'email-editor')
  const hidden = await publish(owner, 'not-invited')
  const target = { kind: 'email', email } as const
  const policy = await send(`/api/v1/admin/sharing/${work.id}`, 'PUT', admin, {
    override: { externalEmail: true, externalLinks: null },
  })
  expect(policy.status).toBe(200)
  const grant = await invite(work.path, owner, target, 'edit', 30)
  expect((await accept(grant, guest)).status).toBe(404)
  provider.mailboxes.set('guest', [verified])
  expect(await (await accept(grant, guest)).json()).toMatchObject({ artifactId: work.id })
  provider.mailboxes.set('guest', [])
  provider.mailboxes.set('other', [verified])
  expect((await accept(grant, other)).status).toBe(404)
  expect((await send(work.path, 'GET', other)).status).toBe(404)
  provider.mailboxes.set('other', [])
  provider.mailboxes.set('guest', [verified])
  expect((await send(hidden.path, 'GET', guest)).status).toBe(404)
  expect(
    (
      await send(work.path, 'PATCH', guest, {
        baseVersion: 1,
        edits: [{ old_str: '第一稿', new_str: '外部评审修订' }],
      })
    ).status,
  ).toBe(200)
  expect(await (await send(work.path, 'GET', owner)).json()).toMatchObject({
    version: { source: '<h1>外部评审修订</h1>', author: 'human:github-303' },
  })
  const comment = { kind: 'comment', version: 2, body: '请复核', audience: 'human' }
  expect((await send(`${work.path}/feedback`, 'POST', guest, comment)).status).toBe(201)
  expect(
    (await send(`${work.path}/feedback`, 'POST', guest, { ...comment, audience: 'agent' })).status,
  ).toBe(403)
  expect(
    (await send('/api/v1/feedback/await', 'POST', guest, { id: work.id, timeoutSec: 1 })).status,
  ).toBe(403)
  expect((await send(`${work.path}/share`, 'POST', guest, { role: 'edit' })).status).toBe(403)
  advance(31)
  expect((await send(work.path, 'GET', guest)).status).toBe(404)
  expect((await accept(grant, guest)).status).toBe(404)
  expect((await send(work.path, 'GET', owner)).status).toBe(200)
})

it('外部邮箱默认关闭，但可邀请已验证邮箱属于当前 Hub 成员的协作者', async () => {
  const { login, publish, send, invite, accept } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const guest = await login('guest')
  const work = await publish(owner, 'internal-email')
  const denied = await send(`${work.path}/invitations`, 'POST', owner, {
    target: { kind: 'email', email: 'guest@example.net' },
    role: 'comment',
    ttlSeconds: 300,
  })
  expect(denied.status).toBe(403)
  const grant = await invite(
    work.path,
    owner,
    { kind: 'email', email: 'member@example.net' },
    'comment',
  )
  expect((await accept(grant, guest)).status).toBe(404)
  expect((await accept(grant, member)).status).toBe(200)
  expect(await (await send(work.path, 'GET', member)).json()).toMatchObject({
    access: { role: 'comment' },
  })
})
