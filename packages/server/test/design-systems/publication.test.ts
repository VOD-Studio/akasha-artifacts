import {
  type DesignSystemDraft,
  DesignSystemPreviewOutputSchema,
  DesignSystemSnapshotSchema,
  DesignSystemWriteOutputSchema,
  readDesignSystemReference,
  removedDesignSystemItems,
} from '@akasha/protocol'
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
  const publish = (draft: DesignSystemDraft, reviewToken: string, slug: string, overrides = {}) =>
    post('publish', {
      draft,
      reviewToken,
      buildApproved: draft.components.length > 0,
      slug,
      title: slug,
      confirmedRemovals: [],
      ...overrides,
    })
  const fixed = async (id: string, version: number) =>
    DesignSystemWriteOutputSchema.parse(
      await (await fetch(`${server.baseUrl}/api/v1/artifacts/${id}?version=${version}`)).json(),
    )
  return { post, send, preview, publish, fixed }
}

it('publishes a brand without building code or fetching its Figma reference', async () => {
  const api = await setup()
  const { reviewToken, sourceVersion } = await api.preview(brand)
  const response = await api.publish(brand, reviewToken, 'identity')
  expect(response.status).toBe(201)
  const system = DesignSystemWriteOutputSchema.parse(await response.json())
  expect(system.artifact.type).toBe('design-system')
  const snapshot = DesignSystemSnapshotSchema.parse(JSON.parse(system.version.source))
  expect(snapshot.draft).toEqual(brand)
  expect(snapshot.sourceVersion).toBe(sourceVersion)
  const board = DesignSystemWriteOutputSchema.parse(
    await (
      await api.post('generate', {
        id: system.artifact.publicId,
        version: 1,
        slug: 'brand-board',
        title: 'Brand board',
      })
    ).json(),
  )
  expect(board.version.source).toContain('data:font/ttf;base64,')
  expect(board.version.source).toContain('data:image/svg+xml;base64,')
  expect(board.version.source).not.toContain('https://www.figma.com')
  expect(readDesignSystemReference(board.version.source)).toEqual({
    id: system.artifact.publicId,
    version: 1,
    sourceVersion,
    components: [],
  })
})

it('pins the actual selected implementation, keeps human guidance, and requires each removal', async () => {
  const api = await setup()
  const original = buttons('#e01234')
  const before = await api.preview(original)
  const system = DesignSystemWriteOutputSchema.parse(
    await (await api.publish(original, before.reviewToken, 'components')).json(),
  )
  const id = system.artifact.publicId
  const selected = { path: 'src/Button.tsx', exportName: 'ConfirmButton' }
  const generate = async (version: number, slug: string) =>
    DesignSystemWriteOutputSchema.parse(
      await (
        await api.post('generate', { id, version, slug, title: slug, component: selected })
      ).json(),
    )
  const first = await generate(1, 'before')
  expect(first.version.source).toContain('Sent from original')
  expect(first.version.source).not.toContain('Private badge implementation')
  expect(first.version.source).toContain('#e01234')
  const next = buttons('#167abc')
  next.files = next.files.filter((f) => f.path !== 'src/Badge.tsx')
  next.components = next.components.filter((c) => c.path !== 'src/Badge.tsx')
  const after = await api.preview(next)
  expect(after.sourceVersion).not.toBe(before.sourceVersion)
  const overrides = { id, baseVersion: 1 }
  const missing = removedDesignSystemItems(original, next)
  expect(missing).toEqual(['file:src/Badge.tsx', 'component:src/Badge.tsx#default'])
  expect(
    (
      await api.publish(next, after.reviewToken, 'components', {
        ...overrides,
        confirmedRemovals: missing.slice(1),
      })
    ).status,
  ).toBe(400)
  expect((await api.publish(next, before.reviewToken, 'components', overrides)).status).toBe(403)
  const update = await api.publish(next, after.reviewToken, 'components', {
    ...overrides,
    confirmedRemovals: missing,
  })
  expect(update.status).toBe(200)
  expect(
    (
      await api.publish(next, after.reviewToken, 'components', {
        ...overrides,
        confirmedRemovals: missing,
      })
    ).status,
  ).toBe(409)
  const latest = DesignSystemWriteOutputSchema.parse(await update.json())
  expect(
    DesignSystemSnapshotSchema.parse(JSON.parse(latest.version.source)).draft.guidance.instructions,
  ).toBe(original.guidance.instructions)
  const second = await generate(2, 'after')
  expect(second.version.source).toContain('#167abc')
  expect(readDesignSystemReference(second.version.source)).toEqual({
    id,
    version: 2,
    sourceVersion: after.sourceVersion,
    components: [selected],
  })
  expect((await api.fixed(first.artifact.publicId, 1)).version).toEqual(first.version)
  expect((await api.fixed(id, 1)).version).toEqual(system.version)
  expect((await generate(1, 'pinned-again')).version.source).toBe(first.version.source)
})

it('rejects unauthorized projects, missing or host dependencies, and all generic writes to a system', async () => {
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
  const { reviewToken } = await api.preview(brand)
  const create = {
    draft: brand,
    reviewToken,
    buildApproved: false,
    slug: 'brand',
    title: 'brand',
    confirmedRemovals: [],
  }
  expect((await api.post('publish', create, 'two')).status).toBe(403)
  const system = DesignSystemWriteOutputSchema.parse(
    await (await api.post('publish', create)).json(),
  )
  const id = system.artifact.publicId
  expect(
    (await api.post('generate', { id, version: 1, slug: 'copy', title: 'copy' }, 'two')).status,
  ).toBe(404)
  expect(
    (
      await api.send('/api/v1/artifacts', {
        project: 'one',
        slug: 'injected',
        title: 'unreviewed',
        type: 'design-system',
        source: system.version.source,
      })
    ).status,
  ).toBe(403)
  expect(
    (
      await api.send('/api/v1/artifacts', {
        project: 'one',
        slug: 'brand',
        title: 'changed type',
        type: 'html',
        source: '<p>changed</p>',
        baseVersion: 1,
      })
    ).status,
  ).toBe(403)
  expect(
    (await api.send(`/api/v1/artifacts/${id}`, { source: '{}', baseVersion: 1 }, 'PATCH')).status,
  ).toBe(403)
  expect(
    (await api.send(`/api/v1/artifacts/${id}/revert`, { targetVersion: 1, baseVersion: 1 })).status,
  ).toBe(403)
  expect((await api.fixed(id, 1)).artifact.headVersion).toBe(1)
})
