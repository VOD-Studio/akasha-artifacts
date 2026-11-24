import { expect, it } from 'vitest'
import { parseArtboardValue, resolveArtboardTweaks } from '../src/index.js'

const duration = { id: 'duration', type: 'number', label: '时长', default: 2, min: 0, max: 8 }
const variants = {
  id: 'variant',
  type: 'enum',
  label: '版式',
  labels: { en: 'Layout' },
  default: 'wide',
  options: [
    { value: 'wide', label: '宽' },
    { value: 'compact', label: '紧凑' },
  ],
}

it('同名参数在各画板使用独立的范围和默认值', () => {
  const parsed = parseArtboardValue({
    boards: [
      {
        id: 'x2',
        title: 'X2',
        appearance: { background: '#f0f0f0', cornerRadius: 18 },
        tweaks: [
          duration,
          variants,
          { id: 'visible', type: 'boolean', label: '显示', default: true },
        ],
      },
      { id: 'x3', title: 'X3', tweaks: [{ ...duration, default: 5, min: 4 }] },
    ],
  })
  if (!parsed.ok) throw new Error(parsed.error)
  const [x2, x3] = parsed.data.boards
  expect(
    resolveArtboardTweaks(x2.tweaks ?? [], { duration: 3, variant: 'unknown', visible: false }),
  ).toEqual({
    duration: 3,
    variant: 'wide',
    visible: false,
  })
  expect(resolveArtboardTweaks(x3.tweaks ?? [], { duration: 3, visible: false })).toEqual({
    duration: 5,
  })
  expect(resolveArtboardTweaks(x2.tweaks ?? [])).toEqual({
    duration: 2,
    variant: 'wide',
    visible: true,
  })
})

it.each([
  [duration, duration],
  [{ ...duration, default: 9 }],
  [{ ...duration, min: 8, max: 0 }],
  [{ ...variants, default: 'unknown' }],
  [{ ...variants, options: [variants.options[0], variants.options[0]] }],
  [{ id: 'accent', type: 'color', label: '强调色', default: 'not-a-hex-color' }],
])('不接受无唯一合法默认值的画板参数：%j', (...tweaks) => {
  const result = parseArtboardValue({ boards: [{ id: 'x2', title: 'X2', tweaks }] })
  expect(result).toMatchObject({ ok: false, error: expect.stringContaining('boards[0].tweaks') })
})
