import { expect, it } from 'vitest'
import { z } from 'zod'
import { sqliteHub } from './sqlite-hub.js'

it('管理员独立收紧两类外发授权；既有邀请、链接及浏览器凭据遵守本制品的例外', async () => {
  const { login, send, publish, invite, accept, link, open } = await sqliteHub()
  const owner = await login('owner')
  const admin = await login('admin')
  const guest = await login('guest')
  const first = await publish(owner, 'policy-exception')
  const second = await publish(owner, 'policy-default')
  const policyPath = `/api/v1/admin/sharing/${first.id}`
  const defaults = { externalLinks: true, externalEmail: true }
  expect(await (await send('/api/v1/auth/session', 'GET', admin)).json()).toMatchObject({
    user: { admin: true },
  })
  expect(await (await send('/api/v1/auth/session', 'GET', owner)).json()).toMatchObject({
    user: { admin: false },
  })
  expect((await send(policyPath, 'GET', owner)).status).toBe(403)
  expect((await send(policyPath, 'PUT', owner, { defaults })).status).toBe(403)
  expect((await send(first.path, 'GET', admin)).status).toBe(404)
  expect((await send(policyPath, 'PUT', admin, { defaults })).status).toBe(200)
  const external = await Promise.all([link(first.path, owner), link(second.path, owner)])
  const target = { kind: 'email', email: 'guest@example.net' } as const
  const firstGrant = await invite(first.path, owner, target)
  const secondGrant = await invite(second.path, owner, target)
  expect((await accept(firstGrant, guest)).status).toBe(200)
  expect((await accept(secondGrant, guest)).status).toBe(200)
  const peer = await open()
  const blocked = { externalLinks: false, externalEmail: false }
  expect((await peer.send(policyPath, 'PUT', admin, { defaults: blocked })).status).toBe(200)
  const [firstLink, secondLink] = external
  for (const [work, saved] of [
    [first, firstLink],
    [second, secondLink],
  ] as const) {
    expect((await send(saved.url)).status).toBe(404)
    expect((await send(work.path, 'GET', saved.cookie)).status).toBe(404)
    expect((await send(work.path, 'GET', guest)).status).toBe(404)
    expect((await send(`${work.path}/share`, 'POST', owner, { role: 'view' })).status).toBe(403)
    expect(
      (
        await send(`${work.path}/invitations`, 'POST', owner, {
          target,
          role: 'view',
          ttlSeconds: 60,
        })
      ).status,
    ).toBe(403)
    expect(await (await send(`${work.path}?version=1`, 'GET', owner)).json()).toMatchObject({
      version: { source: '<h1>第一稿</h1>' },
    })
  }
  const override = { externalLinks: true, externalEmail: null }
  expect((await peer.send(policyPath, 'PUT', admin, { override })).status).toBe(200)
  expect(await (await send(policyPath, 'GET', admin)).json()).toEqual({
    defaults: blocked,
    override,
  })
  expect((await send(firstLink.url)).status).toBe(302)
  expect((await send(first.path, 'GET', firstLink.cookie)).status).toBe(200)
  expect((await send(first.path, 'GET', guest)).status).toBe(404)
  expect((await send(secondLink.url)).status).toBe(404)
  expect(
    (
      await peer.send(policyPath, 'PUT', admin, {
        override: { externalEmail: true, externalLinks: null },
      })
    ).status,
  ).toBe(200)
  expect((await send(first.path, 'GET', firstLink.cookie)).status).toBe(404)
  expect((await send(first.path, 'GET', guest)).status).toBe(200)
  expect((await send(second.path, 'GET', guest)).status).toBe(404)
  expect((await send(first.path, 'GET', admin)).status).toBe(404)
})

it('关闭公开外发也约束旧公开作品的普通书签和库列表，保留成员读取和单作品例外', async () => {
  const { login, publish, send } = await sqliteHub()
  const owner = await login('owner')
  const admin = await login('admin')
  const member = await login('member')
  const guest = await login('guest')
  const affected = await publish(owner, 'old-public', 'public')
  const exception = await publish(owner, 'still-public', 'public')
  const list = async (cookie: string) => {
    const response = await send('/api/v1/artifacts', 'GET', cookie)
    expect(response.status).toBe(200)
    return z
      .object({ artifacts: z.array(z.object({ publicId: z.string() })) })
      .parse(await response.json()).artifacts
  }
  for (const cookie of ['', guest, member]) {
    expect((await send(affected.path, 'GET', cookie)).status).toBe(200)
    expect(await list(cookie)).toContainEqual(expect.objectContaining({ publicId: affected.id }))
  }
  expect(
    (
      await send(`/api/v1/admin/sharing/${exception.id}`, 'PUT', admin, {
        override: { externalLinks: true, externalEmail: null },
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await send(`/api/v1/admin/sharing/${affected.id}`, 'PUT', admin, {
        defaults: { externalLinks: false, externalEmail: true },
      })
    ).status,
  ).toBe(200)
  for (const cookie of ['', guest]) {
    expect((await send(affected.path, 'GET', cookie)).status).toBe(404)
    expect((await send(exception.path, 'GET', cookie)).status).toBe(200)
    expect(await list(cookie)).toEqual([expect.objectContaining({ publicId: exception.id })])
  }
  expect((await send(affected.path, 'GET', member)).status).toBe(200)
  expect(await list(member)).toContainEqual(expect.objectContaining({ publicId: affected.id }))
})
