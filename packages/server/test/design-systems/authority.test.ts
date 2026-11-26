import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DesignSystemPreviewOutputSchema,
  DesignSystemWriteOutputSchema,
  ProjectSchema,
} from '@akasha/protocol'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createLocalContainer } from '../../src/app/create-local-container.js'
import { sqliteHub } from '../hub-sharing/sqlite-hub.js'
import { brand } from './brand.js'

it('an edit link is not a project grant, including when a different owner previews the same brand', async () => {
  const hub = await sqliteHub()
  const owner = await hub.login('owner')
  const other = await hub.login('member')
  const project = async (cookie: string) => {
    const response = await hub.send('/api/v1/projects', 'POST', cookie, {
      name: 'Identity',
      rootPath: 'identity',
    })
    return z.object({ project: ProjectSchema }).parse(await response.json()).project.id
  }
  const ownId = await project(owner)
  const url = (id: string) => `/api/v1/projects/${encodeURIComponent(id)}/design-systems`
  const view = await hub.send(`${url(ownId)}/preview`, 'POST', owner, {
    draft: brand,
    buildApproved: false,
  })
  const { reviewToken } = DesignSystemPreviewOutputSchema.parse(await view.json())
  const published = await hub.send(`${url(ownId)}/publish`, 'POST', owner, {
    draft: brand,
    slug: 'brand',
    title: 'Brand',
    buildApproved: false,
    confirmedRemovals: [],
    reviewToken,
  })
  const { artifact } = DesignSystemWriteOutputSchema.parse(await published.json())
  const { cookie } = await hub.link(`/api/v1/artifacts/${artifact.publicId}`, owner)
  const input = { draft: brand, buildApproved: false }
  expect((await hub.send(`${url(ownId)}/preview`, 'POST', cookie, input)).status).toBe(404)
  expect((await hub.send(`${url(ownId)}/preview`, 'POST', other, input)).status).toBe(404)
})

it('never imports unchecked on-disk design systems, including before the watcher sees an edit', async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'akasha-reviewed-'))
  const artifactsDir = path.join(root, '.artifacts')
  const container = createLocalContainer({
    storageMode: 'fs',
    artifactsDir,
    fsProjectId: 'one',
    fsWatchDebounceMs: 5000,
  })
  try {
    await container.ready
    const review = await container.service.designSystems.preview('one', {
      draft: brand,
      buildApproved: false,
    })
    const input = {
      draft: brand,
      reviewToken: review.reviewToken,
      slug: 'identity',
      title: 'Identity',
      confirmedRemovals: [],
      buildApproved: false,
    }
    const published = await container.service.designSystems.publish('one', input, 'human:local')
    const directory = path.join(artifactsDir, 'design-system', 'identity')
    const file = path.join(directory, 'index.json')
    fs.writeFileSync(file, '{"source":"not reviewed"}')
    await expect(
      container.service.designSystems.publish(
        'one',
        { ...input, id: published.artifact.publicId, baseVersion: 1 },
        'human:local',
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' })
    await expect(container.fsWatcher?.syncFile(file)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(
      (await container.service.getArtifact({ id: published.artifact.publicId })).version.source,
    ).toBe(published.version.source)
    const foreign = path.join(artifactsDir, 'design-system', 'foreign')
    fs.mkdirSync(foreign, { recursive: true })
    fs.writeFileSync(path.join(foreign, 'index.json'), published.version.source)
    await expect(
      container.service.designSystems.publish('one', { ...input, slug: 'foreign' }, 'human:local'),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' })
    await expect(
      container.service.getArtifact({ id: 'foreign', projectId: 'one' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  } finally {
    container.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
