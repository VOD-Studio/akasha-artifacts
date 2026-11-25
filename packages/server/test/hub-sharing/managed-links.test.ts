import { expect, it } from 'vitest'
import { z } from 'zod'
import { sqliteHub } from './sqlite-hub.js'

it('所有者管理普通链接后，已兑换凭据和重开旧地址都只能使用当前角色', async () => {
  const { login, publish, send, link } = await sqliteHub()
  const owner = await login('owner')
  const work = await publish(owner, 'managed-link')
  const saved = await link(work.path, owner)
  const grants = z
    .object({
      grants: z
        .array(
          z.object({
            target: z.object({ kind: z.literal('link') }),
            id: z.string(),
            entry: z.object({ kind: z.literal('artifact') }),
            role: z.literal('edit'),
          }),
        )
        .length(1),
    })
    .parse(await (await send(`${work.path}/sharing`, 'GET', owner)).json()).grants
  const grant = grants.at(0)
  if (!grant) throw new Error('分享设置未列出普通链接')
  const path = `${work.path}/sharing/grants/${grant.id}`
  const rename = (cookie: string, baseVersion: number, before: string, after: string) =>
    send(work.path, 'PATCH', cookie, { baseVersion, edits: [{ old_str: before, new_str: after }] })
  expect((await rename(saved.cookie, 1, '第一稿', '修改稿')).status).toBe(200)
  expect((await send(path, 'PATCH', owner, { role: 'view' })).status).toBe(200)
  const reopened = await send(saved.url)
  expect(reopened.status).toBe(302)
  const cookie = reopened.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('重开链接未提供凭据')
  for (const reader of [saved.cookie, cookie]) {
    expect(await (await send(work.path, 'GET', reader)).json()).toMatchObject({
      access: { role: 'view' },
      version: { source: '<h1>修改稿</h1>' },
    })
    expect((await rename(reader, 2, '修改稿', '第三稿')).status).toBe(403)
  }
  expect((await send(path, 'PATCH', owner, { role: 'edit' })).status).toBe(200)
  expect((await rename(saved.cookie, 2, '修改稿', '第三稿')).status).toBe(200)
  expect((await send(path, 'DELETE', owner)).status).toBe(200)
  expect((await send(saved.url)).status).toBe(404)
  expect((await send(work.path, 'GET', saved.cookie)).status).toBe(404)
})

it.each([
  { kind: 'version', version: 1 },
  { kind: 'play', version: 1, pageId: '', boardId: 'main' },
] as const)('固定入口 $kind 允许查看与批注，但签发和改权都不能授予编辑', async (entry) => {
  const { login, publish, send } = await sqliteHub()
  const owner = await login('owner')
  const work = await publish(owner, 'fixed-link')
  const issue = (role: string) => send(`${work.path}/share`, 'POST', owner, { role, entry })
  const list = async () => (await send(`${work.path}/sharing`, 'GET', owner)).json()

  const invalid = await issue('edit')
  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
  expect(await list()).toMatchObject({ grants: [] })

  expect((await issue('view')).status).toBe(201)
  const settings = await list()
  expect(settings).toMatchObject({ grants: [{ entry, role: 'view', target: { kind: 'link' } }] })
  const {
    grants: [grant],
  } = z.object({ grants: z.tuple([z.object({ id: z.string() })]) }).parse(settings)
  const changeRole = (role: string) =>
    send(`${work.path}/sharing/grants/${grant.id}`, 'PATCH', owner, { role })
  expect((await changeRole('comment')).status).toBe(200)
  const rejected = await changeRole('edit')
  expect(rejected.status).toBe(400)
  expect(await rejected.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } })
  expect(await list()).toMatchObject({ grants: [{ id: grant.id, entry, role: 'comment' }] })
  expect((await changeRole('view')).status).toBe(200)
})
