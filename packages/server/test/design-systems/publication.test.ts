import { type DesignSystemDraft, DesignSystemPreviewOutputSchema } from '@akasha/protocol'
import { expect, it, onTestFinished } from 'vitest'
import { startNodeServer } from '../../src/entry/node.js'
import { brand, buttons } from './brand.js'

async function setup() {
  const server = await startNodeServer({ dbPath: ':memory:', port: 0 })
  onTestFinished(server.close)
  const send = (path: string, body: unknown, method = 'POST', token = server.token) =>
    fetch(server.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  for (const id of ['one', 'two'])
    expect(
      (await send('/api/v1/projects', { id, rootPath: `/selected/${id}`, name: id })).status,
    ).toBe(201)
  const post = (action: string, body: unknown, project = 'one') =>
    send(`/api/v1/projects/${project}/design-systems/${action}`, body)
  const preview = async (draft: DesignSystemDraft) => {
    const response = await post('preview', { draft, buildApproved: draft.components.length > 0 })
    expect(response.status).toBe(200)
    return DesignSystemPreviewOutputSchema.parse(await response.json())
  }
  return { post, send, preview }
}

it('previews selected brand assets without building code or fetching Figma references', async () => {
  const api = await setup()
  const { previewSource } = await api.preview(brand)
  expect(previewSource).toContain('data:font/ttf;base64,')
  expect(previewSource).toContain('data:image/svg+xml;base64,')
  expect(previewSource).not.toContain('https://www.figma.com')
})

it('rejects unauthorized projects, missing or host dependencies, and unchecked component builds', async () => {
  const api = await setup()
  const draft = buttons('#334455')
  expect(
    (
      await api.send(
        '/api/v1/projects/one/design-systems/preview',
        { draft, buildApproved: true },
        'POST',
        'wrong',
      )
    ).status,
  ).toBe(401)
  expect((await api.post('preview', { draft, buildApproved: false })).status).toBe(403)
  for (const dependency of [
    'node:fs',
    '/etc/passwd',
    '../../package.json',
    'https://example.invalid/button.js',
    'unselected-package',
    './Missing',
  ]) {
    const changed = structuredClone(draft)
    changed.files[0].content = `import ${JSON.stringify(dependency)};${changed.files[0].content}`
    expect((await api.post('preview', { draft: changed, buildApproved: true })).status).toBe(400)
  }
  const broken = structuredClone(draft)
  broken.files[0].content = 'export function ConfirmButton( {'
  expect((await api.post('preview', { draft: broken, buildApproved: true })).status).toBe(400)
  const outside = structuredClone(brand)
  outside.files[0].path = '../other/logo.svg'
  expect((await api.post('preview', { draft: outside, buildApproved: false })).status).toBe(400)
})
