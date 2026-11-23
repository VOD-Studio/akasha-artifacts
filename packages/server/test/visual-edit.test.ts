import { ArtifactPullFeedbackOutputSchema, ArtifactSchema, type EditOp } from '@akasha/protocol'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { startNodeServer } from '../src/entry/node.js'

async function createFixture(source: string, type: 'html' | 'react' | 'artboard') {
  const server = await startNodeServer({ dbPath: 'memory', port: 0 })
  async function request(path: string, body?: unknown) {
    const params = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }
    return fetch(`${server.baseUrl}/api/v1${path}`, {
      ...params,
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
    })
  }
  try {
    const response = await request('/artifacts', {
      slug: 'visual-edit',
      title: '可视化直改',
      type,
      source,
    })
    expect(response.status).toBe(201)
    const { artifact } = z.object({ artifact: ArtifactSchema }).parse(await response.json())
    const path = `/artifacts/${artifact.publicId}/visual-edit`
    return { request, path, close: server.close, id: artifact.publicId }
  } catch (error) {
    await server.close()
    throw error
  }
}

describe('可视化直改版本与反馈', () => {
  it('预览不写入版本，对四种修改分别保存并逐步撤销', async () => {
    const source = '<ul>\n  <li class="text-sm">A</li>\n  <li>B</li>\n</ul>'
    const fixture = await createFixture(source, 'html')
    const { request, path, id } = fixture
    try {
      const capability = await request(`${path}?baseVersion=1&loc=2:3`)
      expect(await capability.json()).toMatchObject({
        target: { text: 'A', className: 'text-sm', order: { parentLoc: '1:1' } },
      })
      const steps: Array<{ op: EditOp; source: string }> = [
        {
          op: { kind: 'text', loc: '2:3', value: 'AA' },
          source: '<ul>\n  <li class="text-sm">AA</li>\n  <li>B</li>\n</ul>',
        },
        {
          op: { kind: 'className', loc: '2:3', value: 'font-bold' },
          source: '<ul>\n  <li class="font-bold">AA</li>\n  <li>B</li>\n</ul>',
        },
        {
          op: { kind: 'move', loc: '2:3', targetParentLoc: '1:1', index: 1 },
          source: '<ul>\n  <li>B</li>\n  <li class="font-bold">AA</li>\n</ul>',
        },
        {
          op: { kind: 'remove', loc: '2:3' },
          source: '<ul>\n  \n  <li class="font-bold">AA</li>\n</ul>',
        },
      ]
      let baseVersion = 1
      for (const step of steps) {
        const command = { baseVersion, op: step.op }
        const preview = await request(`${path}/preview`, command)
        expect(preview.status).toBe(200)
        expect(await preview.json()).toEqual({ source: step.source })
        expect(await (await request(`/artifacts/${id}`)).json()).toMatchObject({
          artifact: { headVersion: baseVersion },
        })
        const response = await request(path, command)
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          version: {
            version: baseVersion + 1,
            parentVersion: baseVersion,
            source: step.source,
            author: 'human:web',
          },
        })
        baseVersion++
      }
      for (let undoVersion = baseVersion; undoVersion > 1; undoVersion--) {
        expect(await (await request(`${path}?baseVersion=${baseVersion}`)).json()).toEqual({
          undoVersion,
        })
        const result = await request(path, { baseVersion, undoVersion })
        expect(result.status).toBe(200)
        expect(await result.json()).toMatchObject({
          version: {
            version: baseVersion + 1,
            parentVersion: baseVersion,
            source: steps[undoVersion - 3]?.source ?? source,
          },
        })
        baseVersion++
      }
      expect(await (await request(`${path}?baseVersion=${baseVersion}`)).json()).toEqual({
        undoVersion: null,
      })
      const feedback = ArtifactPullFeedbackOutputSchema.parse(
        await (await request(`/feedback?id=${id}&detail=false`)).json(),
      )
      expect(feedback.items).toHaveLength(8)
      expect(feedback.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'edit',
            author: 'human:web',
            version: 2,
            body: expect.stringContaining('修改文字'),
          }),
          expect.objectContaining({
            kind: 'edit',
            author: 'human:web',
            version: 9,
            body: expect.stringContaining('撤销'),
          }),
        ]),
      )
    } finally {
      await fixture.close()
    }
  })

  it('拒绝动态节点和基准版本过期的并发写入', async () => {
    const fixture = await createFixture(
      'export default () => <p>{items.map(i => <b>{i}</b>)}<em>静态</em></p>',
      'react',
    )
    const { request, path, id } = fixture
    try {
      const dynamicLoc = '1:41'
      expect(await (await request(`${path}?baseVersion=1&loc=${dynamicLoc}`)).json()).toEqual({
        target: null,
      })
      const refused = await request(path, {
        baseVersion: 1,
        op: { kind: 'remove', loc: dynamicLoc },
      })
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: { details: { annotationOnly: true } } })
      const op = { kind: 'text', loc: '1:53', value: '修改' }
      const writes = await Promise.all([
        request(path, { baseVersion: 1, op }),
        request(path, { baseVersion: 1, op }),
      ])
      expect(writes.map(({ status }) => status).sort()).toEqual([200, 409])
      const conflict = writes.find(({ status }) => status === 409)
      expect(await conflict?.json()).toMatchObject({
        error: {
          code: 'VERSION_CONFLICT',
          details: {
            artifactId: id,
            baseVersion: 1,
            headVersion: 2,
            authors: ['human:web'],
            diff: expect.any(String),
          },
        },
      })
      const staleUndo = await request(path, { baseVersion: 1, undoVersion: 2 })
      expect(staleUndo.status).toBe(409)
      expect(await (await request(`/artifacts/${id}`)).json()).toMatchObject({
        artifact: { headVersion: 2 },
      })
    } finally {
      await fixture.close()
    }
  })

  it('在同一版本内只预览指定画板的静态文本，其他同位置元素不变', async () => {
    const document = {
      boards: [
        { id: 'desktop', title: '桌面', html: '<p>桌面标题</p>' },
        { id: 'phone', title: '手机', html: '<p>手机标题</p>' },
      ],
    }
    const { request, path, id, close } = await createFixture(JSON.stringify(document), 'artboard')
    try {
      const target = await request(`${path}?baseVersion=1&boardId=phone&loc=1%3A1`)
      expect(target.status).toBe(200)
      expect(await target.json()).toMatchObject({ target: { text: '手机标题' } })

      const preview = await request(`${path}/preview`, {
        baseVersion: 1,
        boardId: 'phone',
        op: { kind: 'text', loc: '1:1', value: '提前 < 2 天' },
      })
      expect(preview.status).toBe(200)
      const { source } = z.object({ source: z.string() }).parse(await preview.json())
      expect(JSON.parse(source).boards).toEqual([
        document.boards[0],
        { ...document.boards[1], html: '<p>提前 &lt; 2 天</p>' },
      ])
      expect(await (await request(`/artifacts/${id}`)).json()).toMatchObject({
        version: { version: 1, source: JSON.stringify(document) },
      })
      const gone = await request(`${path}?baseVersion=1&boardId=missing&loc=1%3A1`)
      expect(await gone.json()).toEqual({ target: null })
    } finally {
      await close()
    }
  })

  it('首次编辑旧画板文字及撤销时保留旧定位、页面归属与流程边', async () => {
    const legacy = JSON.stringify({
      pages: [{ title: 'page-1' }],
      boards: [
        { title: '同名画板', pageId: 'page-1', html: '<p>第一板</p>' },
        { title: '同名画板', pageId: 'page-1', html: '<p>第二板</p>' },
      ],
      flows: [{ from: 'board-1', to: 'board-2' }],
    })
    const { request, path, close } = await createFixture(legacy, 'artboard')
    const readVersion = z.object({ version: z.object({ version: z.number(), source: z.string() }) })
    const boardId = 'legacy-board:v1:board-2'
    const pageId = 'legacy-page:v1:page-1'
    try {
      const saved = await request(path, {
        baseVersion: 1,
        boardId,
        op: { kind: 'text', loc: '1:1', value: '新文案' },
      })
      expect(saved.status).toBe(200)
      const { version: updated } = readVersion.parse(await saved.json())
      expect(updated.version).toBe(2)
      const parsed = JSON.parse(updated.source)
      expect(parsed).toMatchObject({
        pages: [{ id: pageId, title: 'page-1' }],
        boards: [
          { id: 'legacy-board:v1:board-1', legacyId: 'board-1', pageId, html: '<p>第一板</p>' },
          { id: boardId, legacyId: 'board-2', pageId, html: '<p>新文案</p>' },
        ],
        flows: [{ from: 'legacy-board:v1:board-1', to: boardId }],
      })
      const undo = await request(path, { baseVersion: 2, undoVersion: 2 })
      expect(undo.status).toBe(200)
      const { version: undone } = readVersion.parse(await undo.json())
      expect(undone.version).toBe(3)
      parsed.boards[1].html = '<p>第二板</p>'
      expect(JSON.parse(undone.source)).toEqual(parsed)
    } finally {
      await close()
    }
  })
})
