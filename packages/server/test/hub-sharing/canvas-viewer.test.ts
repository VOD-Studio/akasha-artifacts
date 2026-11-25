import { ArtifactSchema } from '@akasha/protocol'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { sqliteHub } from './sqlite-hub.js'

it('受邀查看者能读取画布属性和预览所需的画板；撤下再恢复不会让旧画板书签重新获得授权', async () => {
  const { login, send, invite, accept } = await sqliteHub()
  const owner = await login('owner')
  const member = await login('member')
  const html = '<button>确认订单</button>'
  const published = await send('/api/v1/artifacts', 'POST', owner, {
    slug: 'design/checkout',
    type: 'artboard',
    title: '支付流程',
    source: JSON.stringify({ boards: [{ id: 'checkout', title: '付款', html }] }),
  })
  expect(published.status).toBe(201)
  const { artifact } = z.object({ artifact: ArtifactSchema }).parse(await published.json())
  const path = `/api/v1/artifacts/${artifact.publicId}`
  const grant = await invite(path, owner, { kind: 'member', login: 'member' })
  expect((await accept(grant, member)).status).toBe(200)
  const canvas = `${path}?view=canvas&version=1`
  const board = `${path}/boards?version=1&boardId=checkout`
  expect(await (await send(canvas, 'GET', member)).json()).toMatchObject({
    artifact: { title: '支付流程' },
    canvas: { boards: [{ id: 'checkout', title: '付款' }] },
  })
  expect(await (await send(board, 'GET', member)).json()).toMatchObject({
    version: 1,
    board: { html },
  })
  expect((await send(path, 'DELETE', owner)).status).toBe(200)
  expect((await send(`${path}/restore`, 'POST', owner, {})).status).toBe(200)
  expect((await send(board, 'GET', owner)).status).toBe(200)
  expect((await send(canvas, 'GET', member)).status).toBe(404)
  expect((await send(board, 'GET', member)).status).toBe(404)
  expect((await accept(grant, member)).status).toBe(404)
})
