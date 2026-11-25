import { expect, it } from 'vitest'
import {
  type ArtboardTweakValues,
  applyArtboardTweakApplication,
  listArtboardTweakTargets,
} from '../src/index.js'

const speed = { id: 'speed', type: 'number', min: 0, max: 8, default: 2, label: '速度' }
const motion = { id: 'motion', type: 'boolean', default: true, label: '动画' }
const accent = { id: 'accent', type: 'color', default: '#667788', label: '强调色' }
const layout = {
  id: 'layout',
  type: 'enum',
  default: 'wide',
  label: '布局',
  labels: { en: 'Layout', ar: 'تخطيط' },
  options: [
    { value: 'wide', label: '宽' },
    { value: 'compact', label: '紧凑', labels: { de: 'Kompakt' }, metadata: { preset: 3 } },
  ],
  authorNotes: ['保留'],
}
const extras = { id: 'shadow', type: 'boolean', default: true, label: '阴影' }
const fields = [speed, motion, layout, accent, extras]
const values = { speed: 0, motion: false, layout: 'compact', accent: '#123abc' }
const adjusted = [
  { ...speed, default: 0 },
  { ...motion, default: false },
  { ...layout, default: 'compact' },
  { ...accent, default: '#123abc' },
  extras,
]
const original = { id: 'a', title: '首页', pageId: 'p', tweaks: fields, html: '<b>首页</b>' }
const other = { id: 'b', title: '设置', tweaks: [{ ...speed, default: 0 }, ...fields.slice(1)] }
const untouched = { id: 'c', title: '未选择', tweaks: fields }
const document = {
  boards: [original, other, untouched],
  pages: [{ id: 'p', title: '主流程', data: { category: '流程' } }],
  flows: [{ from: 'a', to: 'b' }],
  authors: ['设计组'],
}
const source = JSON.stringify(document)

it('两版只在选中画板的指定默认值上有差异，保留零值、关态、本地化和未知字段', () => {
  const result = applyArtboardTweakApplication(source, 4, {
    boardId: 'a',
    targetIds: ['a', 'b'],
    values,
  })
  expect(result.changed).toEqual([
    { id: 'a', title: '首页' },
    { id: 'b', title: '设置' },
  ])
  expect(JSON.parse(result.source)).toEqual({
    ...document,
    boards: [{ ...original, tweaks: adjusted }, { ...other, tweaks: adjusted }, untouched],
  })
  expect(listArtboardTweakTargets(source, 4, 'a', values).map((board) => board.status)).toEqual([
    'changed',
    'changed',
    'changed',
  ])
  expect(
    listArtboardTweakTargets(result.source, 5, 'c', values).map((board) => board.status),
  ).toEqual(['unchanged', 'unchanged', 'changed'])
})

it('按声明列出所有画板，缺字段、越界、选项或类型不同均不可选', () => {
  const boards = [
    original,
    other,
    { id: 'same', title: '无需变化', tweaks: adjusted },
    { id: 'none', title: '无参数' },
    { id: 'missing', title: '缺颜色', tweaks: [speed, motion, layout] },
    { id: 'range', title: '下界不同', tweaks: [{ ...speed, min: 1 }, motion, layout, accent] },
    {
      id: 'option',
      title: '无紧凑选项',
      tweaks: [speed, motion, { ...layout, options: [layout.options[0]] }, accent],
    },
    {
      id: 'type',
      title: '枚举而非布尔',
      tweaks: [
        speed,
        {
          ...layout,
          id: 'motion',
          default: '1',
          options: [
            { value: '1', label: '开' },
            { value: '0', label: '关' },
          ],
        },
        layout,
        accent,
      ],
    },
  ]
  const input = JSON.stringify({ boards })
  expect(listArtboardTweakTargets(input, 4, 'a', values)).toEqual([
    { id: 'a', title: '首页', status: 'changed' },
    { id: 'b', title: '设置', status: 'changed' },
    { id: 'same', title: '无需变化', status: 'unchanged' },
    { id: 'none', title: '无参数', status: 'incompatible' },
    { id: 'missing', title: '缺颜色', status: 'incompatible' },
    { id: 'range', title: '下界不同', status: 'incompatible' },
    { id: 'option', title: '无紧凑选项', status: 'incompatible' },
    { id: 'type', title: '枚举而非布尔', status: 'incompatible' },
  ])
  for (const targetIds of [
    [],
    ['b', 'b'],
    ['b', 'removed'],
    ...boards.slice(2).map(({ id }) => ['b', id]),
  ]) {
    expect(() =>
      applyArtboardTweakApplication(input, 4, { boardId: 'a', targetIds, values }),
    ).toThrow()
  }
  const result = applyArtboardTweakApplication(input, 4, { boardId: 'a', targetIds: ['b'], values })
  expect(result.changed).toEqual([{ id: 'b', title: '设置' }])
  expect(JSON.parse(result.source).boards).toEqual([
    original,
    { ...other, tweaks: adjusted },
    ...boards.slice(2),
  ])
})

it.each<[string, ArtboardTweakValues]>([
  ['a', {}],
  ['removed', { speed: 0 }],
  ['a', { removed: 0 }],
  ['a', { speed: '0' }],
  ['a', { speed: -1 }],
  ['a', { motion: 0 }],
  ['a', { accent: 'red' }],
  ['a', { layout: 'absent' }],
  ['a', { speed: 2, motion: false }],
])('源画板 %s 的无效或默认值不允许在列举和写入时回退：%j', (boardId, values) => {
  expect(() => listArtboardTweakTargets(source, 4, boardId, values)).toThrow()
  expect(() =>
    applyArtboardTweakApplication(source, 4, { boardId, targetIds: ['b'], values }),
  ).toThrow()
})

it('旧稿同名画板的版本标识不能挪用，首次采用后两块板和流程端点保持原位', () => {
  const input = JSON.stringify({
    boards: [
      { title: '同名', tweaks: [speed] },
      { title: '同名', tweaks: [speed] },
    ],
    flows: [{ from: 'board-1', to: 'board-2' }],
  })
  const boardId = 'legacy-board:v4:board-1'
  const target = 'legacy-board:v4:board-2'
  const application = { boardId, targetIds: [target], values: { speed: 0 } }
  expect(() => applyArtboardTweakApplication(input, 5, application)).toThrow()
  const result = applyArtboardTweakApplication(input, 4, application)
  expect(JSON.parse(result.source)).toEqual({
    boards: [
      { id: boardId, title: '同名', tweaks: [speed], legacyId: 'board-1' },
      { id: target, title: '同名', tweaks: [{ ...speed, default: 0 }], legacyId: 'board-2' },
    ],
    flows: [{ from: boardId, to: target }],
  })
  expect(() => applyArtboardTweakApplication(result.source, 5, application)).toThrow()
})
