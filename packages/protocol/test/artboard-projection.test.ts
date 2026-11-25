import { expect, it } from 'vitest'
import {
  DesignLayerSchema,
  getArtboardPaperSize,
  parseArtboardValue,
  projectArtboard,
  resolveDesignLayerColors,
} from '../src/index.js'

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

it('打印纸张保留实际物理尺寸，只有位图分配才取整', () => {
  const a4 = getArtboardPaperSize('a4')
  expect((a4.width * 25.4) / 96).toBeCloseTo(210, 10)
  expect((a4.height * 25.4) / 96).toBeCloseTo(297, 10)
  expect(getArtboardPaperSize('letter')).toEqual({ width: 816, height: 1056 })
})

it.each([
  { printLayout: null },
  { printLayout: { mode: 'fixed', paper: 'letter' } },
  { printLayout: { mode: 'flow', width: 210, height: 297 } },
  { printLayout: { mode: 'flow', paper: 'a3' } },
  { printLayout: { mode: 'fixed' }, viewport: { width: 0, height: 800 } },
  {
    layoutGuides: [
      { axis: 'x', position: 0 },
      { axis: 'x', position: 0 },
    ],
  },
  { layoutGuides: [{ axis: 'z', position: 1 }] },
  { layoutGuides: [{ axis: 'y', position: -1 }] },
  { layoutGuides: [{ axis: 'x', position: Number.NaN }] },
  { layoutGuides: [{ axis: 'y', position: 8193 }] },
  { layoutGuides: Array.from({ length: 65 }, (_, position) => ({ axis: 'x', position })) },
])('拒绝有误的打印声明：%j', (fields) => {
  expect(parseArtboardValue({ boards: [{ title: '申请表', ...fields }] }).ok).toBe(false)
})

it('独立的播放声明随索引传输，不把缺省当作关闭', () => {
  const projection = projectArtboard(
    JSON.stringify({
      boards: [
        { title: '旧稿' },
        { title: '静态', presentation: { animation: false, interactive: false } },
        { title: '仅动画', presentation: { animation: true } },
        { title: '仅原型', presentation: { interactive: true } },
        { title: '动画和原型', presentation: { animation: true, interactive: true } },
        { title: '无效字段', presentation: { animation: 'true', interactive: false } },
      ],
    }),
    4,
  )
  if (!projection) throw new Error('画板夹具不能解析')
  expect(projection.index.boards.map(({ presentation }) => presentation)).toEqual([
    undefined,
    { animation: false, interactive: false },
    { animation: true },
    { interactive: true },
    { animation: true, interactive: true },
    { interactive: false },
  ])
  for (const board of projection.contents) {
    expect(board).not.toHaveProperty('presentation')
  }
})

it('原生图层校验排版、翻转和十六进制颜色，拒绝非法样式值', () => {
  const text = DesignLayerSchema.parse({
    id: 'heading',
    kind: 'text',
    x: -20,
    y: 12,
    width: 240,
    height: 60,
    text: '自定义标题',
    color: '#9ca3af',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    flipX: true,
  })
  expect(resolveDesignLayerColors(text, '#ffffff')).toEqual({
    foreground: '#9ca3af',
    surface: undefined,
    contrastBackground: '#ffffff',
  })
  const rect = DesignLayerSchema.parse({
    id: 'card',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    color: '#2563eb',
    flipY: true,
  })
  expect(resolveDesignLayerColors(rect)).toEqual({
    foreground: '#2563eb',
    surface: '#2563eb',
    contrastBackground: '#ffffff',
  })
  expect(
    DesignLayerSchema.safeParse({
      id: 'bad-color',
      kind: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      text: 'x',
      color: 'rgb(0,0,0)',
    }).success,
  ).toBe(false)
  expect(
    DesignLayerSchema.safeParse({
      id: 'bad-size',
      kind: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      text: 'x',
      fontSize: 9,
    }).success,
  ).toBe(false)
})
