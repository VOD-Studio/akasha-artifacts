import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, it, onTestFinished } from 'vitest'
import { startNodeServer } from '../../server/src/entry/node.js'
import { buttons } from '../../server/test/design-systems/brand.js'
import { CodingSessionClient, createCodingSessionMcp } from '../src/coding-session.js'

async function setup() {
  const server = await startNodeServer({ dbPath: ':memory:', port: 0 })
  onTestFinished(server.close)
  const send = (path: string, body: unknown, token = server.token, method = 'POST') =>
    fetch(server.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  for (const id of ['one', 'two'])
    expect(
      (await send('/api/v1/projects', { id, rootPath: `/projects/${id}`, name: id })).status,
    ).toBe(201)
  const design = (action: string, body: unknown) =>
    send(`/api/v1/projects/one/design-systems/${action}`, body)
  const draft = buttons('#445566')
  const { reviewToken } = await (await design('preview', { draft, buildApproved: true })).json()
  const system = await (
    await design('publish', {
      draft,
      buildApproved: true,
      reviewToken,
      slug: 'ui',
      title: 'UI',
      confirmedRemovals: [],
    })
  ).json()
  const component = { path: 'src/Button.tsx', exportName: 'ConfirmButton' }
  const board = await (
    await design('generate', {
      id: system.artifact.publicId,
      version: 1,
      slug: 'checkout',
      title: '结账',
      component,
    })
  ).json()
  const reference = {
    projectId: 'one',
    artifactId: board.artifact.publicId,
    version: 1,
    pageId: '',
    boardId: 'main',
    element: { boardId: 'main', selector: 'button' },
  }
  const create = (project: string, token = server.token) =>
    send(`/api/v1/projects/${project}/coding-sessions`, { reference, label: '结账项目' }, token)
  const response = await create('one')
  expect(response.status).toBe(201)
  const { id, token } = await response.json()
  const connection = { origin: server.baseUrl, projectId: 'one', id, token }
  return { server, send, board, create, component, reference, connection }
}

it('续接同一编码会话只读冻结选区与已审阅组件实现', async () => {
  const { server, send, board, create, component, reference, connection } = await setup()
  expect((await create('two')).status).toBe(403)
  expect((await create('one', connection.token)).status).toBe(401)
  expect(
    (
      await send(
        `/api/v1/artifacts/${reference.artifactId}`,
        { baseVersion: 1, source: 'another head' },
        server.token,
        'PATCH',
      )
    ).status,
  ).toBe(200)
  const read = await new CodingSessionClient(connection).read()
  expect(read).toMatchObject({
    reference,
    design: { source: board.version.source, version: 1 },
    components: [{ ...component, source: expect.stringContaining('Sent from original') }],
  })
  expect(JSON.stringify(read)).not.toContain('Private badge implementation')
  const mcp = createCodingSessionMcp(new CodingSessionClient(connection))
  const client = new Client({ name: 'workspace', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await mcp.connect(left)
  await client.connect(right)
  onTestFinished(() => client.close())
  const result = await client.callTool({ name: 'coding_session_read', arguments: {} })
  expect(result.isError).not.toBe(true)
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(read) }])
  await expect(
    new CodingSessionClient({ ...connection, projectId: 'two' }).read(),
  ).rejects.toThrow()
  await expect(
    new CodingSessionClient({ ...connection, token: 'expired' }).read(),
  ).rejects.toThrow()
})
