// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showEditableWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

function touch(target: Element, type: string, id: number, x: number, y: number, time = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperties(event, {
    pointerId: { value: id },
    pointerType: { value: 'touch' },
    isPrimary: { value: id === 1 },
    timeStamp: { value: time },
  })
  fireEvent(target, event)
}

it('第二指接管标题拖动，以两指中点缩放；抬指尾段不选择或保存画板', () => {
  const editor = showEditableWorkspace(
    detailFor(
      1,
      JSON.stringify({
        ...design,
        boards: design.boards.map((board) =>
          board.id === 'mobile' ? { ...board, position: { x: 80, y: 90 } } : board,
        ),
      }),
    ),
  )
  const canvas = screen.getByRole('region', { name: '画布' })
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 20, 2400, 2100))
  const title = screen.getByRole('button', { name: '宽屏首页' })
  const hit = screen.getByRole('button', { name: '选择画板：手机首页' })
  const board = title.closest<HTMLElement>('.artifact-canvas-board')
  if (!board) throw new Error('缺少画板')
  const left = Number.parseFloat(board.style.left)
  const top = Number.parseFloat(board.style.top)
  touch(title, 'pointerdown', 1, 120, 110)
  touch(title, 'pointermove', 1, 130, 120)
  expect(Number.parseFloat(board.style.left)).toBe(left + 10)
  touch(hit, 'pointerdown', 2, 230, 120)
  expect(Number.parseFloat(board.style.left)).toBe(left)
  touch(canvas, 'pointermove', 2, 330, 120)
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe('200%')
  expect(Number.parseFloat(board.style.left)).toBe(2 * left - 100)
  expect(Number.parseFloat(board.style.top)).toBe(2 * top - 100)
  touch(canvas, 'pointerup', 2, 330, 120)
  touch(title, 'pointermove', 1, 80, 70)
  touch(title, 'pointerup', 1, 80, 70)
  fireEvent.click(hit, { detail: 1 })
  expect(screen.getByRole('button', { name: '手机首页' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  expect(editor.submittedVersion).toBeUndefined()
  touch(hit, 'pointerdown', 1, 80, 70)
  touch(hit, 'pointerup', 1, 80, 70)
  fireEvent.click(hit, { detail: 1 })
  expect(screen.getByRole('button', { name: '手机首页' }).getAttribute('aria-pressed')).toBe('true')
})

it.each(['pointercancel', 'lostpointercapture'])(
  '%s 放弃拖板；下一次触摸拖动只发布一次',
  async (cancel) => {
    const editor = showEditableWorkspace(detailFor())
    const title = screen.getByRole('button', { name: '宽屏首页' })
    const board = title.closest<HTMLElement>('.artifact-canvas-board')
    if (!board) throw new Error('缺少画板')
    const left = Number.parseFloat(board.style.left)
    touch(title, 'pointerdown', 1, 10, 20)
    touch(title, 'pointermove', 1, 50, 40)
    expect(Number.parseFloat(board.style.left)).toBe(left + 40)
    touch(title, cancel, 1, 50, 40)
    touch(title, 'pointerup', 1, 50, 40)
    expect(Number.parseFloat(board.style.left)).toBe(left)
    expect(editor.submittedVersion).toBeUndefined()
    const content = screen.getByRole('button', { name: '选择画板：宽屏首页' })
    touch(content, 'pointerdown', 1, 10, 20, 100)
    touch(content, 'pointermove', 1, 40, 32, 800)
    expect(Number.parseFloat(board.style.left)).toBe(left + 30)
    expect(editor.submittedVersion).toBeUndefined()
    touch(content, 'pointerup', 1, 40, 32, 900)
    await waitFor(() => expect(editor.current.version.version).toBe(2))
    expect(JSON.parse(editor.current.version.source).boards[0].position).toEqual({ x: 30, y: 12 })
  },
)

it('从空白处起手也能双指平移，两指取消后单指滑动不框选或修改作品', () => {
  const editor = showEditableWorkspace(detailFor())
  const canvas = screen.getByRole('region', { name: '画布' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  const board = title.closest<HTMLElement>('.artifact-canvas-board')
  if (!board) throw new Error('缺少画板')
  const left = Number.parseFloat(board.style.left)
  const top = Number.parseFloat(board.style.top)
  touch(canvas, 'pointerdown', 1, 100, 100)
  touch(canvas, 'pointerdown', 2, 200, 100)
  touch(canvas, 'pointermove', 1, 120, 120)
  touch(canvas, 'pointermove', 2, 220, 120)
  expect(Number.parseFloat(board.style.left)).toBeCloseTo(left + 20)
  expect(Number.parseFloat(board.style.top)).toBeCloseTo(top + 20)
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe('100%')
  touch(canvas, 'pointercancel', 1, 120, 120)
  touch(canvas, 'lostpointercapture', 2, 220, 120)
  touch(canvas, 'pointerdown', 1, 80, 80)
  touch(canvas, 'pointermove', 1, 130, 90)
  touch(canvas, 'pointerup', 1, 130, 90)
  expect(Number.parseFloat(board.style.left)).toBeCloseTo(left + 70)
  expect(screen.queryByTestId('canvas-marquee')).toBeNull()
  expect(editor.submittedVersion).toBeUndefined()
})

const detailWithNote = () =>
  detailFor(
    1,
    JSON.stringify({
      ...design,
      boards: design.boards.map((board) =>
        board.id === 'mobile'
          ? {
              ...board,
              designLayers: [
                { id: 'note', kind: 'note', x: 10, y: 20, width: 100, height: 50, text: '预约' },
              ],
            }
          : board,
      ),
    }),
  )

it('总览长按文字不依赖双击，末尾的点击不会发出第二次选点', () => {
  stubResizeObserver()
  const editor = showEditableWorkspace(detailWithNote())
  const hit = screen.getByRole('button', { name: '选择画板：手机首页' })
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 195, 422))
  const frame = sandbox(screen.getByTitle('画板内容：手机首页'))
  frame.receive({ type: 'ready' })
  touch(hit, 'pointerdown', 1, 119, 130, 100)
  touch(hit, 'pointermove', 1, 120, 130, 220)
  touch(hit, 'pointerup', 1, 120, 130, 800)
  fireEvent.click(hit, { clientX: 120, clientY: 130, detail: 1 })
  const picks = frame.post.mock.calls.flatMap(([message]) =>
    message.type === 'inspect.at' ? [message] : [],
  )
  expect(picks).toEqual([expect.objectContaining({ purpose: 'text', x: 40, y: 60, version: 1 })])
  frame.receive({
    type: 'inspect.target',
    purpose: 'text',
    version: 1,
    requestId: picks[0].requestId,
    element: { blockId: 'design-layer:note', selector: 'aside', textPreview: '预约' },
  })
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '文字' }).value).toBe('预约')
  expect(editor.submittedVersion).toBeUndefined()
})
