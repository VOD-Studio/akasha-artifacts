import { expect, it } from 'vitest'
import { createCanvasDocument } from '../src/entities/artifact'
import {
  type CanvasExportSelection,
  resolveSelectedExportBoards,
} from '../src/widgets/ArtifactWorkspace/canvas-export-selection'

const version = { artifactId: 'booking', version: 4 }
const document = createCanvasDocument(
  'artboard',
  '预约',
  JSON.stringify({
    pages: [
      { id: 'design', title: '设计' },
      { id: 'review', title: '评审' },
    ],
    boards: [
      { id: 'spacer', title: '起始页', pageId: 'design', viewport: { width: 320, height: 240 } },
      { id: 'auto', title: '预约', pageId: 'design' },
      { id: 'first', title: '提示甲', pageId: 'design', position: { x: 120, y: 0 } },
      { id: 'second', title: '提示乙', pageId: 'design', position: { x: 120, y: 0 } },
      { id: 'review-only', title: '评审记录', pageId: 'review' },
      { id: 'shared', title: '导航', position: { x: 500, y: -40 } },
    ],
  }),
  version.version,
  { columns: 2 },
)

function selection(boardIds: readonly string[]): CanvasExportSelection {
  return { ...version, pageId: 'design', columns: 2, boardIds }
}

it('按整页快照的纵横坐标导出，共用板参与排序，同坐标保留页面定义顺序', () => {
  const selected = selection(['second', 'auto', 'shared', 'first'])
  const boards = resolveSelectedExportBoards(document, version, selected)
  expect(boards.map((board) => board.id)).toEqual(['shared', 'first', 'second', 'auto'])
  expect(selected.boardIds).toEqual(['second', 'auto', 'shared', 'first'])
  expect(document.pages[0]?.boards.map((board) => board.id)).toEqual([
    'spacer',
    'auto',
    'first',
    'second',
    'shared',
  ])
})

it('非连续的两张画板不会夹带中间未选中的画板', () => {
  const boards = resolveSelectedExportBoards(document, version, selection(['second', 'auto']))
  expect(boards.map((board) => board.id)).toEqual(['second', 'auto'])
})

it('空字符串可定位合成总览页', () => {
  const overview = createCanvasDocument('html', '预约', '<h1>预约</h1>', version.version, undefined)
  const board = overview.pages[0]?.boards[0]
  if (!board) throw new Error('总览页缺少画板')
  expect(
    resolveSelectedExportBoards(overview, version, { ...selection([board.id]), pageId: '' }),
  ).toEqual([board])
})

it.each(['review-only', 'deleted'])('选区含页外或已删除的成员 %s 时整体失败', (id) => {
  expect(() => resolveSelectedExportBoards(document, version, selection(['first', id]))).toThrow(
    /所选画板/,
  )
})

it.each([{ artifactId: 'another' }, { version: 5 }])(
  '作品或版本不对应时拒绝旧选区：%o',
  (change) => {
    expect(() =>
      resolveSelectedExportBoards(document, { ...version, ...change }, selection(['first'])),
    ).toThrow(/固定版本/)
  },
)

it('页面不存在时不从其他页补选同名成员', () => {
  expect(() =>
    resolveSelectedExportBoards(document, version, { ...selection(['shared']), pageId: 'deleted' }),
  ).toThrow(/页面/)
})

it('空选区不能导出整页', () => {
  expect(() => resolveSelectedExportBoards(document, version, selection([]))).toThrow(/未选择画板/)
})
