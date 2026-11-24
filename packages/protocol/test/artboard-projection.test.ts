import { expect, it } from 'vitest'
import { projectArtboard } from '../src/index.js'

const appearance = { background: '#f0f0f0', cornerRadius: 18 }
const tweaks = [
  {
    id: 'density',
    type: 'enum',
    label: '页面密度',
    default: 'compact',
    options: [
      { value: 'compact', label: '紧凑' },
      { value: 'roomy', label: '宽松' },
    ],
  },
]

it('布局、单板读取和旧稿链接使用相同标识，不在索引传输正文', () => {
  const projection = projectArtboard(
    JSON.stringify({
      pages: [{ title: '预约' }],
      boards: [
        {
          title: '信息',
          pageId: 'page-1',
          html: '<h1>保留原内容</h1>',
          appearance,
          tweaks,
        },
        { id: 'done', title: '完成', pageId: 'missing', description: '已完成' },
      ],
      flows: [{ from: 'board-1', to: 'done' }],
    }),
    4,
  )
  if (!projection) throw new Error('画板夹具不能解析')
  const { index, contents } = projection
  const [board, unplaced] = index.boards
  expect(board).toMatchObject({ pageId: index.pages[0].id, legacyId: 'board-1', cornerRadius: 18 })
  expect(unplaced).toMatchObject({ id: 'done', unplaced: true })
  expect(index.flows).toEqual([{ from: board.id, to: 'done', label: undefined }])
  expect(contents).toMatchObject([
    { id: board.id, html: '<h1>保留原内容</h1>', appearance, tweaks },
    { id: 'done', description: '已完成' },
  ])
  expect(board).not.toHaveProperty('appearance')
  expect(board).not.toHaveProperty('tweaks')
  expect(JSON.stringify(index)).not.toMatch(/保留原内容|已完成/)
})
