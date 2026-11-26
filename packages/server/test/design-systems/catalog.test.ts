import {
  type DesignSystemDraft,
  DesignSystemPreviewOutputSchema,
  DesignSystemWriteOutputSchema,
  ProjectSchema,
} from '@akasha/protocol'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { sqliteHub } from '../hub-sharing/sqlite-hub.js'
import { brand, buttons } from './brand.js'

async function setupCatalog() {
  const hub = await sqliteHub()
  const account = async (login: string) => {
    const cookie = await hub.login(login)
    const project = await hub.send('/api/v1/projects', 'POST', cookie, {
      name: 'Design',
      rootPath: 'design',
    })
    const { id } = z.object({ project: ProjectSchema }).parse(await project.json()).project
    const path = `/api/v1/projects/${encodeURIComponent(id)}`
    return { cookie, project: id, path, catalog: `${path}/system-catalog` }
  }
  const owner = await account('owner')
  const member = await account('member')
  const admin = await account('admin')
  const publish = async (draft: DesignSystemDraft = brand, slug = 'identity') => {
    const common = { draft, buildApproved: draft.components.length > 0 }
    const root = `${owner.path}/design-systems`
    const preview = await hub.send(`${root}/preview`, 'POST', owner.cookie, common)
    const { reviewToken } = DesignSystemPreviewOutputSchema.parse(await preview.json())
    const response = await hub.send(`${root}/publish`, 'POST', owner.cookie, {
      ...common,
      slug,
      title: 'Identity',
      confirmedRemovals: [],
      reviewToken,
    })
    return DesignSystemWriteOutputSchema.parse(await response.json()).artifact.publicId
  }
  return { hub, owner, member, admin, publish }
}

it('固定版点名共享只公开组件目录，组织身份和源项目均由 Hub 核验', async () => {
  const { hub, owner, member, admin, publish } = await setupCatalog()
  const id = await publish()
  const path = `${owner.catalog}/${id}/1/members`
  const peer = await hub.open()
  const catalog = async () => (await peer.send(member.catalog, 'GET', member.cookie)).json()
  expect(await catalog()).toMatchObject({ items: [] })
  expect((await hub.send(path, 'PUT', admin.cookie, { logins: ['member'] })).status).toBe(404)
  expect((await hub.send(path, 'PUT', owner.cookie, { logins: ['guest'] })).status).toBe(400)
  const update = await hub.send(path, 'PUT', owner.cookie, { logins: ['member'] })
  expect(await update.json()).toEqual({ logins: ['member'] })
  const listed = await catalog()
  expect(listed).toMatchObject({ items: [{ id, version: 1, title: 'Identity' }] })
  expect(JSON.stringify(listed)).not.toContain('triangle.svg')
  expect((await peer.send(`/api/v1/artifacts/${id}`, 'GET', member.cookie)).status).toBe(404)
  expect(await (await peer.send(admin.catalog, 'GET', admin.cookie)).json()).toMatchObject({
    items: [],
  })
  hub.provider.organization.delete('member')
  expect((await peer.send(member.catalog, 'GET', member.cookie)).ok).toBe(false)
  hub.provider.organization.add('member')
  expect((await hub.send(path, 'PUT', owner.cookie, { logins: [] })).ok).toBe(true)
  expect(await catalog()).toMatchObject({ items: [] })
})

it('管理员从可用版本发布团队基础；默认与撤回对两名成员及旧生成入口立即生效', async () => {
  const { hub, owner, member, admin, publish } = await setupCatalog()
  const id = await publish()
  const target = `${admin.catalog}/${id}/1/publication`
  const action = (value: string) => hub.send(target, 'PUT', admin.cookie, { action: value })
  expect((await action('publish')).status).toBe(404)
  expect(
    (
      await hub.send(`${owner.catalog}/${id}/1/members`, 'PUT', owner.cookie, {
        logins: ['admin'],
      })
    ).ok,
  ).toBe(true)
  expect(
    (
      await hub.send(`${owner.catalog}/${id}/1/publication`, 'PUT', owner.cookie, {
        action: 'default',
        admin: true,
      })
    ).status,
  ).toBe(403)
  expect((await action('publish')).ok).toBe(true)
  expect((await action('default')).ok).toBe(true)
  const generated = await hub.send(`${owner.path}/design-systems/generate`, 'POST', owner.cookie, {
    id,
    version: 1,
    slug: 'saved-design',
    title: 'Saved design',
  })
  const saved = DesignSystemWriteOutputSchema.parse(await generated.json())
  const second = await hub.open()
  for (const account of [owner, member]) {
    const response = await second.send(account.catalog, 'GET', account.cookie)
    expect(await response.json()).toMatchObject({
      items: [{ id, version: 1, publication: 'team', isDefault: true }],
    })
  }
  expect((await second.send(`/api/v1/artifacts/${id}`, 'GET', member.cookie)).status).toBe(404)
  expect((await action('withdraw')).ok).toBe(true)
  for (const account of [owner, member]) {
    const response = await second.send(account.catalog, 'GET', account.cookie)
    expect(await response.json()).toMatchObject({ items: [] })
  }
  const savedDetail = await second.send(
    `/api/v1/artifacts/${saved.artifact.publicId}`,
    'GET',
    owner.cookie,
  )
  expect(await savedDetail.json()).toMatchObject({ version: { source: saved.version.source } })
  expect(
    (
      await second.send(`${owner.path}/design-systems/generate`, 'POST', owner.cookie, {
        id,
        version: 1,
        slug: 'retired',
        title: 'Retired',
      })
    ).status,
  ).toBe(404)
})

it('两名成员继承固定基础，关闭只影响本人；同名组件按来源合成一份独立作品', async () => {
  const { hub, owner, member, admin, publish } = await setupCatalog()
  const first = await publish(buttons('#ae1122'), 'first')
  const second = await publish(buttons('#2266bb'), 'second')
  for (const id of [first, second]) {
    await hub.send(`${owner.catalog}/${id}/1/members`, 'PUT', owner.cookie, { logins: ['admin'] })
    await hub.send(`${admin.catalog}/${id}/1/publication`, 'PUT', admin.cookie, {
      action: 'publish',
    })
  }
  await hub.send(`${admin.catalog}/${first}/1/publication`, 'PUT', admin.cookie, {
    action: 'default',
  })
  const peer = await hub.open()
  const generate = (account: typeof member, slug: string, selections?: unknown[]) =>
    peer.send(`${account.catalog}/generate`, 'POST', account.cookie, {
      title: 'Checkout',
      slug,
      selections,
    })
  for (const account of [owner, member]) {
    const response = await generate(account, 'inherited')
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ references: [{ id: first, version: 1 }] })
  }
  await hub.send(`${member.catalog}/preference`, 'PUT', member.cookie, { inheritDefault: false })
  expect(await (await generate(member, 'blank')).json()).toMatchObject({ references: [] })
  expect(await (await generate(owner, 'again')).json()).toMatchObject({
    references: [{ id: first }],
  })
  expect(await (await generate(owner, 'without-base', [])).json()).toMatchObject({ references: [] })
  const forged = await peer.send(`${owner.catalog}/preference`, 'PUT', member.cookie, {
    inheritDefault: false,
  })
  expect(forged.status).toBe(404)
  const component = { path: 'src/Button.tsx', exportName: 'ConfirmButton' }
  const selections = [first, second].map((id) => ({ id, version: 1, component }))
  const output = await (await generate(member, 'combined', selections)).json()
  expect(output).toMatchObject({
    artifact: { projectId: member.project, visibility: 'private' },
    references: selections.map(({ id }) => ({ id, version: 1, components: [component] })),
  })
  const saved = DesignSystemWriteOutputSchema.parse(output)
  expect(saved.version.source).toContain('#ae1122')
  expect(saved.version.source).toContain('#2266bb')
  expect(saved.version.source).not.toContain('Private badge implementation')
  await hub.send(`${admin.catalog}/${first}/1/publication`, 'PUT', admin.cookie, {
    action: 'withdraw',
  })
  expect((await generate(member, 'unavailable', selections)).status).toBe(404)
  const reopened = await peer.send(
    `/api/v1/artifacts/${saved.artifact.publicId}`,
    'GET',
    member.cookie,
  )
  expect(await reopened.json()).toMatchObject({ version: { source: saved.version.source } })
})
