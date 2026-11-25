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
  expect((await send(path, 'DELETE', owner)).status).toBe(200)
  expect((await send(saved.url)).status).toBe(404)
  expect((await send(work.path, 'GET', saved.cookie)).status).toBe(404)
})
