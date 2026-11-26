import { ArtifactSchema, VersionSchema } from '@akasha/protocol'
import { expect, it } from 'vitest'
import { sqliteHub } from './sqlite-hub.js'

const layer = (id: string) => ({ id, kind: 'text', x: 0, y: 0, width: 80, height: 24, text: id })
const original = {
  boards: [
    { id: 'home', title: '首页', designLayers: [layer('title'), layer('hint')] },
    { id: 'settings', title: '设置', designLayers: [] },
  ],
  teamExtension: { colors: ['#222222'] },
}

async function openDesign(source = JSON.stringify(original), visibility = 'team') {
  const hub = await sqliteHub()
  const owner = await hub.login('owner')
  const member = await hub.login('member')
  const published = await hub.send('/api/v1/artifacts', 'POST', owner, {
    slug: 'artboard/home',
    type: 'artboard',
    visibility,
    title: '首页流程',
    source,
  })
  expect(published.status).toBe(201)
  const id = ArtifactSchema.parse((await published.json()).artifact).publicId
  const path = `/api/v1/artifacts/${id}`
  const edit = (cookie: string, baseVersion: number, source: unknown) =>
    hub.send(`${path}/canvas-edits`, 'POST', cookie, {
      baseVersion,
      source: JSON.stringify(source),
      author: 'human:forged',
    })
  const canvas = (cookie: string, version = '') =>
    hub.send(`${path}?view=canvas${version}`, 'GET', cookie)
  return { ...hub, owner, member, path, edit, canvas }
}

it('两名编辑者从同一快照修改不同画板及同板不同对象；重新打开读取已合并头版及真实父版本', async () => {
  const hub = await openDesign()
  const title = structuredClone(original)
  title.boards[0].designLayers[0].text = '新标题'
  const setting = structuredClone(original)
  setting.boards[1].title = '账户设置'
  const [a, b] = await Promise.all([
    hub.edit(hub.owner, 1, title),
    hub.edit(hub.member, 1, setting),
  ])
  expect([a.status, b.status]).toEqual([200, 200])
  const hint = structuredClone(original)
  hint.boards[0].designLayers[1].text = '新提示'
  expect((await hub.edit(hub.member, 1, hint)).status).toBe(200)
  const reopened = await hub.open()
  const version = VersionSchema.parse(
    (await (await reopened.send(hub.path, 'GET', hub.member)).json()).version,
  )
  expect(version).toMatchObject({ version: 4, parentVersion: 3, author: 'human:github-202' })
  expect(JSON.parse(version.source)).toEqual({
    boards: [
      {
        id: 'home',
        title: '首页',
        designLayers: [
          { ...layer('title'), text: '新标题' },
          { ...layer('hint'), text: '新提示' },
        ],
      },
      { id: 'settings', title: '账户设置', designLayers: [] },
    ],
    teamExtension: { colors: ['#222222'] },
  })
  const history = await (await reopened.send(`${hub.path}/versions`, 'GET', hub.owner)).json()
  const versions = VersionSchema.array()
    .parse(history.versions)
    .sort((a, b) => a.version - b.version)
  expect(versions.map(({ parentVersion }) => parentVersion)).toEqual([null, 1, 2, 3])
  expect(JSON.parse(versions[0].source)).toEqual(original)
  expect(
    versions
      .slice(1, 3)
      .map(({ author }) => author)
      .sort(),
  ).toEqual(['human:github-101', 'human:github-202'])
})

it('同一字段、删除对修改的冲突不落版本；CLI/本机采用的普通源码写入仍严格比较基准', async () => {
  const hub = await openDesign()
  const saved = structuredClone(original)
  saved.boards[0].designLayers[0].text = '已采纳'
  expect((await hub.edit(hub.owner, 1, saved)).status).toBe(200)
  const competing = structuredClone(original)
  competing.boards[0].designLayers[0].text = '另一稿'
  const removed = structuredClone(original)
  removed.boards[0].designLayers.shift()
  for (const source of [competing, removed]) {
    const conflict = await hub.edit(hub.member, 1, source)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ error: { code: 'VERSION_CONFLICT' } })
  }
  expect(
    (
      await hub.send(hub.path, 'PATCH', hub.owner, {
        baseVersion: 1,
        source: JSON.stringify(original),
      })
    ).status,
  ).toBe(409)
  const current = await (await hub.send(hub.path, 'GET', hub.member)).json()
  expect(current.version.version).toBe(2)
  expect(JSON.parse(current.version.source)).toEqual(saved)
})

it('画板标识不稳定或候选图层不符合设计约束时拒绝共同编辑，不猜测数组下标', async () => {
  const hub = await openDesign(JSON.stringify({ boards: [{ title: '无标识' }] }))
  expect((await hub.edit(hub.member, 1, original)).status).toBe(409)
  expect(
    (
      await hub.send(hub.path, 'PATCH', hub.owner, {
        baseVersion: 1,
        source: JSON.stringify(original),
      })
    ).status,
  ).toBe(200)
  const invalid = structuredClone(original)
  invalid.boards[0].designLayers[0].width = -1
  expect((await hub.edit(hub.member, 2, invalid)).status).toBe(409)
  expect((await (await hub.send(hub.path, 'GET', hub.owner)).json()).version.version).toBe(2)
})

it('有名编辑授权随降权和撤销即时失效；固定版本不泄漏协作头版', async () => {
  const hub = await openDesign()
  const grant = await hub.invite(hub.path, hub.owner, { kind: 'member', login: 'member' }, 'edit')
  expect((await hub.accept(grant, hub.member)).status).toBe(200)
  expect((await (await hub.canvas(hub.member)).json()).hubCanEditCanvas).toBe(true)
  const draft = structuredClone(original)
  draft.boards[0].title = '成员修订'
  const saved = await hub.edit(hub.member, 1, draft)
  expect(saved.status).toBe(200)
  expect((await saved.json()).version.author).toBe('human:github-202')
  const grantPath = `${hub.path}/sharing/grants/${grant}`
  for (const role of ['comment', 'view']) {
    expect((await hub.send(grantPath, 'PATCH', hub.owner, { role })).status).toBe(200)
    expect((await (await hub.canvas(hub.member)).json()).hubCanEditCanvas).toBe(false)
    expect((await hub.edit(hub.member, 2, original)).status).toBe(403)
  }
  expect((await hub.send(grantPath, 'DELETE', hub.owner)).status).toBe(200)
  expect((await hub.canvas(hub.member)).status).toBe(404)
  expect((await hub.edit(hub.member, 2, original)).status).toBe(404)
  const share = await hub.send(`${hub.path}/share`, 'POST', hub.owner, {
    role: 'view',
    entry: { kind: 'version', version: 1 },
  })
  expect(share.status).toBe(201)
  const redeem = await hub.send((await share.json()).url)
  const fixed = redeem.headers.get('set-cookie')?.split(';')[0] ?? ''
  expect((await (await hub.send(hub.path, 'GET', fixed)).json()).version.version).toBe(1)
  expect((await (await hub.canvas(fixed)).json()).hubCanEditCanvas).toBe(false)
  expect((await hub.edit(fixed, 1, original)).status).toBe(403)
  expect((await hub.edit('', 1, original)).status).toBe(404)
})

it('公开只读画布不提供共编；只有有效编辑链接可保存，且不借用同一浏览器内的账号署名', async () => {
  const hub = await openDesign(undefined, 'public')
  expect((await (await hub.canvas('')).json()).hubCanEditCanvas).toBe(false)
  expect((await hub.edit('', 1, original)).status).toBe(403)
  expect((await (await hub.canvas(hub.owner)).json()).hubCanEditCanvas).toBe(true)
  expect((await (await hub.canvas(hub.owner, '&version=1')).json()).hubCanEditCanvas).toBe(false)
  const link = await hub.link(hub.path, hub.owner)
  const guest = `${await hub.login('guest')}; ${link.cookie}`
  expect((await (await hub.canvas(guest)).json()).hubCanEditCanvas).toBe(true)
  const draft = structuredClone(original)
  draft.boards[1].title = '访客修改'
  const saved = await hub.edit(guest, 1, draft)
  expect(saved.status).toBe(200)
  expect((await saved.json()).version.author).toBe('human:share')
})

it('从空图层列表独立追加的对象均保留；随后两种不一致的重排不能互相覆盖', async () => {
  const hub = await openDesign()
  const one = structuredClone(original)
  one.boards[1].designLayers.push(layer('first'))
  const two = structuredClone(original)
  two.boards[1].designLayers.push(layer('second'), layer('third'))
  expect((await hub.edit(hub.owner, 1, one)).status).toBe(200)
  const both = await hub.edit(hub.member, 1, two)
  expect(both.status).toBe(200)
  const merged = structuredClone(original)
  merged.boards[1].designLayers = [layer('first'), layer('second'), layer('third')]
  expect(JSON.parse((await both.json()).version.source)).toEqual(merged)
  const reverse = structuredClone(merged)
  reverse.boards[1].designLayers.reverse()
  expect((await hub.edit(hub.owner, 3, reverse)).status).toBe(200)
  merged.boards[1].designLayers = [layer('second'), layer('first'), layer('third')]
  expect((await hub.edit(hub.member, 3, merged)).status).toBe(409)
})
