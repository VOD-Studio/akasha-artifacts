import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { origin } from './browser-client.js'
import { sqliteHub } from './sqlite-hub.js'

it('旧收藏兼容原来的讨论范围，但外链禁用与仅本人对地址及已兑换的 Cookie 同时生效', async () => {
  const { login, publish, send, provider } = await sqliteHub()
  const owner = await login('owner')
  const admin = await login('admin')
  const work = await publish(owner, 'legacy-bookmark')
  // 按旧版线格式构造固定到期时间的收藏，不依赖当前签发代码或授权记录。
  const payload = Buffer.from(
    JSON.stringify({
      kind: 'share',
      artifactId: work.id,
      exp: Date.parse('2026-11-25T11:00:00Z') / 1000,
    }),
  ).toString('base64url')
  const signature = createHmac('sha256', provider.oauth.signingSecret)
    .update(`${origin}\n${payload}`)
    .digest('base64url')
  const url = `/auth/share?token=${payload}.${signature}`
  const opened = await send(url)
  expect(opened.status).toBe(302)
  const cookie = opened.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('旧签名未能换取授权')
  expect(await (await send(work.path, 'GET', cookie)).json()).toMatchObject({
    access: { role: 'comment' },
  })
  const externalLinks = (enabled: boolean) =>
    send(`/api/v1/admin/sharing/${work.id}`, 'PUT', admin, {
      override: { externalLinks: enabled, externalEmail: null },
    })
  expect((await externalLinks(false)).status).toBe(200)
  expect((await send(url)).status).toBe(404)
  expect((await send(work.path, 'GET', cookie)).status).toBe(404)
  expect((await externalLinks(true)).status).toBe(200)
  expect((await send(url)).status).toBe(302)
  expect((await send(`${work.path}/sharing/only-me`, 'POST', owner, {})).status).toBe(200)
  expect((await send(url)).status).toBe(404)
  expect((await send(work.path, 'GET', cookie)).status).toBe(404)
})
