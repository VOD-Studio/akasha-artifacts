import { DesignSystemPreviewOutputSchema, ProjectSchema } from '@akasha/protocol'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { sqliteHub } from '../hub-sharing/sqlite-hub.js'
import { brand } from './brand.js'

it('only lets the project owner preview selected brand assets', async () => {
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
  const preview = DesignSystemPreviewOutputSchema.parse(await view.json())
  expect(preview.previewSource).toContain('Triangle')
  const input = { draft: brand, buildApproved: false }
  expect((await hub.send(`${url(ownId)}/preview`, 'POST', other, input)).status).toBe(404)
})
