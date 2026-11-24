import { expect, it } from 'vitest'
import { createCanvasDocument } from '../src/entities/artifact'
import { editCanvasBoards } from '../src/widgets/ArtifactWorkspace/canvas-board-source'
import { layoutBoards } from '../src/widgets/ArtifactWorkspace/canvas-camera'

const source = JSON.stringify({
  pages: [{ title: '预约' }],
  boards: [
    {
      title: '桌面',
      pageId: 'page-1',
      html: '<h1>预约</h1>',
      viewport: { width: 960, height: 640 },
    },
    { id: 'mobile', title: '手机', pageId: 'page-1', viewport: { width: 390, height: 844 } },
  ],
  flows: [{ from: 'board-1', to: 'mobile', label: '预约', custom: true }],
  metadata: { provenance: 'cli' },
})

it('移动到负坐标并调整独立视口；旧定位和流程继续指向原来的画板', () => {
  const before = createCanvasDocument('artboard', '预约', source, 4, undefined)
  const page = before.pages[0]
  const desktop = page?.boards[0]
  if (!page || !desktop) throw new Error('桌面画板夹具不可用')
  const { after: edited, before: undoSource } = editCanvasBoards(source, 4, {
    kind: 'geometry',
    changes: [{ id: desktop.id, bounds: { x: -50, y: 80, width: 720, height: 570 } }],
  })
  const after = createCanvasDocument('artboard', '预约', edited, 5, undefined)
  const editedPage = after.pages[0]
  expect(editedPage?.id).toBe(page.id)
  expect(editedPage?.boards[0]?.legacyBlockId).toBe('board-1')
  const bounds = layoutBoards(editedPage?.boards ?? [], after.columns)
  expect(bounds.bounds.get(desktop.id)).toEqual({ x: -50, y: 80, width: 720, height: 570 })
  expect(bounds.page.x).toBe(-50)
  expect(after.flows[0]).toMatchObject({ from: desktop.id, to: 'mobile' })
  expect(JSON.parse(edited).flows[0].custom).toBe(true)
  expect(JSON.parse(edited).metadata).toEqual({ provenance: 'cli' })
  expect(
    createCanvasDocument('artboard', '预约', undoSource, 6, undefined).pages[0]?.boards[0]?.id,
  ).toBe(desktop.id)
  expect(before.pages[0]?.boards[0]?.width).toBe(960)
})

it('在指定页面创建空画板并删除旧板，不把已删除端点转给新板', () => {
  const page = createCanvasDocument('artboard', '预约', source, 4, undefined).pages[0]
  if (!page) throw new Error('预约页面夹具不可用')
  const { after: added } = editCanvasBoards(source, 4, {
    kind: 'create',
    id: 'blank',
    title: '备注',
    pageId: page.id,
  })
  const { after: deleted } = editCanvasBoards(added, 5, { kind: 'delete', ids: ['mobile'] })
  const final = createCanvasDocument('artboard', '预约', deleted, 6, undefined)
  expect(final.pages[0]?.boards.map((board) => [board.title, board.source])).toEqual([
    ['桌面', '<h1>预约</h1>'],
    ['备注', ''],
  ])
  expect(final.flows).toEqual([])
})

it('复制画板保留 HTML 与已声明的出边，不把旧入口标识分给副本', () => {
  const { pages } = createCanvasDocument('artboard', '预约', source, 4, undefined)
  const original = pages[0]?.boards[0]
  if (!original) throw new Error('桌面画板夹具不可用')
  const { after: edited } = editCanvasBoards(source, 4, {
    kind: 'duplicate',
    boardId: original.id,
    id: 'copy',
    bounds: { x: 120, y: 60, width: 960, height: 640 },
  })
  const final = createCanvasDocument('artboard', '预约', edited, 5, undefined)
  const copy = final.pages[0]?.boards.find((board) => board.id === 'copy')
  expect(copy).toMatchObject({ source: original.source, position: { x: 120, y: 60 } })
  expect(copy?.legacyBlockId).toBeUndefined()
  expect(final.flows).toEqual([
    { from: original.id, to: 'mobile', label: '预约' },
    { from: 'copy', to: 'mobile', label: '预约' },
  ])
})
