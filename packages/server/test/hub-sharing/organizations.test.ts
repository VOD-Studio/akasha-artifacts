import { expect, it } from 'vitest'
import { sqliteHub } from './sqlite-hub.js'

it('组织与组按当前成员资格直接授权；退出一个范围时只保留其它有效角色', async () => {
  const { login, send, publish, invite, accept, provider } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const guest = await login('guest')
  const work = await publish(owner, 'team-design')
  const org = await invite(work.path, owner, { kind: 'organization' }, 'view')
  const group = await invite(work.path, owner, { kind: 'group', slug: 'design' }, 'comment')
  const comment = () =>
    send(`${work.path}/feedback`, 'POST', member, {
      version: 1,
      kind: 'comment',
      audience: 'human',
      body: '设计组意见',
    })
  expect((await comment()).status).toBe(201)
  expect((await accept(group, guest)).status).toBe(404)
  expect((await accept(org, guest)).status).toBe(404)
  expect((await send(work.path, 'GET', guest)).status).toBe(404)
  provider.groups.get('design')?.delete('member')
  expect((await comment()).status).toBe(403)
  expect((await accept(group, member)).status).toBe(404)
  expect(await (await send(work.path, 'GET', member)).json()).toMatchObject({
    access: { role: 'view' },
  })
  provider.organization.delete('member')
  expect((await accept(org, member)).status).toBe(404)
  expect((await send(work.path, 'GET', member)).status).toBe(404)
  provider.organization.add('guest')
  expect((await send(work.path, 'GET', guest)).status).toBe(200)
  expect((await accept(org, guest)).status).toBe(200)
  expect((await accept(group, guest)).status).toBe(404)
})

it('同名组织或组重建后不继承原授权，目录中不存在的组不能签发邀请', async () => {
  const { login, send, publish, invite, accept, provider } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const work = await publish(owner, 'audience-identity')
  const group = { kind: 'group', slug: 'design' } as const
  const first = await invite(work.path, owner, group)
  expect((await accept(first, member)).status).toBe(200)

  provider.groupIds.delete('design')
  const missing = await send(`${work.path}/invitations`, 'POST', owner, {
    target: group,
    role: 'view',
    ttlSeconds: 300,
  })
  expect(missing.status).toBe(404)
  expect((await accept(first, member)).status).toBe(404)
  expect((await send(work.path, 'GET', member)).status).toBe(404)

  provider.groupIds.set('design', 9909)
  expect((await accept(first, member)).status).toBe(404)
  expect((await send(work.path, 'GET', member)).status).toBe(404)
  const replacement = await invite(work.path, owner, group)
  expect((await accept(replacement, member)).status).toBe(200)

  const org = await invite(work.path, owner, { kind: 'organization' })
  expect((await accept(org, member)).status).toBe(200)
  provider.organizationProfile.id = 8808
  expect((await accept(org, member)).status).toBe(404)
  expect((await accept(replacement, member)).status).toBe(404)
  expect((await send(work.path, 'GET', member)).status).toBe(404)
})
