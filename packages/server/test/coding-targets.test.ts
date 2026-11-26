import { createHash, randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { origin } from './hub-sharing/browser-client.js'
import { sqliteHub } from './hub-sharing/sqlite-hub.js'

it('作者将冻结设计交付给活跃远端工作区，重启后可续接且拒绝越权或过期写入', async () => {
  const hub = await sqliteHub()
  const owner = await hub.login('owner')
  const guest = await hub.login('guest')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const start = await hub.send(`/auth/cli?challenge=${challenge}`)
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state')
  const callback = await hub.send(
    `/auth/github/callback?state=${state}&code=owner`,
    'GET',
    start.headers.get('set-cookie')?.split(';')[0],
  )
  const code = (await callback.text()).trim().split('\n').at(-1)
  const { token } = await (
    await hub.send('/api/v1/auth/cli/token', 'POST', '', { verifier, code })
  ).json()
  const project = (
    await (
      await hub.send('/api/v1/projects', 'POST', owner, {
        id: 'checkout',
        name: 'Checkout',
        rootPath: '/checkout',
      })
    ).json()
  ).project.id
  const design = {
    pages: [
      { id: 'browse', title: '商品' },
      { id: 'checkout', title: '结账' },
    ],
    boards: [
      { id: 'catalog', pageId: 'browse', title: '货架', html: '<p>商品</p>' },
      {
        id: 'order',
        pageId: 'checkout',
        title: '确认订单',
        html: '<button id="confirm">下单</button>',
      },
    ],
  }
  const source = JSON.stringify(design)
  const { artifact } = await (
    await hub.send('/api/v1/artifacts', 'POST', owner, {
      project,
      slug: 'cart',
      title: 'Cart',
      type: 'artboard',
      source,
    })
  ).json()
  const reference = {
    projectId: project,
    artifactId: artifact.publicId,
    version: 1,
    pageId: 'checkout',
    boardId: 'order',
    element: { boardId: 'order', selector: '#confirm' },
  }
  const root = `/api/v1/projects/${encodeURIComponent(project)}/coding-sessions`
  const cli = (path: string, key: string, body: unknown, service = hub.fetchRequest) =>
    service(
      new Request(new URL(path, origin), {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  expect((await hub.send(root, 'POST', owner, { label: '伪终端' })).status).toBe(403)
  const grant = await (await cli(root, token, { label: 'Remote checkout' })).json()
  const poll = `${root}/${grant.id}/poll`
  const bind = `${root}/${grant.id}/bind`
  const publish = `${root}/${grant.id}/publish`
  expect(await (await cli(poll, grant.token, {})).json()).toEqual({ bound: false })
  expect(await (await hub.send(`${root}/targets`, 'POST', owner, reference)).json()).toEqual([
    { id: grant.id, label: 'Remote checkout', bound: false },
  ])
  hub.advance(31)
  expect(await (await hub.send(`${root}/targets`, 'POST', owner, reference)).json()).toEqual([])
  expect((await hub.send(bind, 'POST', owner, reference)).status).toBe(409)
  expect((await cli(poll, grant.token, {})).status).toBe(200)
  expect((await hub.send(bind, 'POST', guest, reference)).status).toBe(403)
  expect((await hub.send(bind, 'POST', owner, { ...reference, projectId: 'other' })).status).toBe(
    403,
  )
  expect((await hub.send(bind, 'POST', owner, reference)).status).toBe(200)
  expect(
    (await hub.send(bind, 'POST', owner, { ...reference, element: { selector: 'div' } })).status,
  ).toBe(409)
  const second = await hub.open()
  const remote = (action: string, body: unknown) =>
    cli(`${root}/${grant.id}/${action}`, grant.token, body, second.fetchRequest)
  expect(await (await remote('poll', {})).json()).toEqual({ bound: true })
  expect(await (await remote('read', {})).json()).toMatchObject({
    reference,
    design: {
      source,
      selection: { pageId: 'checkout', boardId: 'order', element: reference.element },
    },
  })
  expect((await hub.send(publish, 'POST', guest, { source: '<p>guest</p>' })).status).toBe(401)
  hub.provider.organization.delete('owner')
  expect((await remote('publish', { source: '<p>revoked</p>' })).status).toBe(403)
  hub.provider.organization.add('owner')
  expect((await remote('publish', { source: source.replace('下单', '立即确认') })).status).toBe(201)
  expect(await (await remote('read', {})).json()).toMatchObject({
    reference,
    design: { source, version: 1 },
  })
  hub.advance(8 * 3600)
  expect((await remote('publish', { source: '<p>expired</p>' })).status).toBe(401)
})
