// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  artifact,
  design,
  detailFor,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  workspace,
} from './canvas-test-fixture'

setupCanvasTest()

it('画板保存后提交对应版本的 Agent 编辑反馈，通知失败不回滚', async () => {
  const editor = showEditableWorkspace(detailFor())
  const request = vi.mocked(fetch)
  const previous = request.getMockImplementation()
  const notifications: unknown[] = []
  request.mockImplementation(async (path, init) => {
    if (path === `/api/v1/artifacts/${artifact.publicId}/feedback` && init?.method === 'POST') {
      notifications.push(JSON.parse(String(init.body)))
      return Response.json(
        { error: { code: 'UNAVAILABLE', message: '通知服务暂不可用' } },
        { status: 500 },
      )
    }
    if (!previous) throw new Error('缺少保存请求处理器')
    return previous(path, init)
  })
  fireEvent.click(screen.getByRole('button', { name: '添加画板' }))
  expect(await screen.findByTitle('画板内容：画板 3')).toBeTruthy()
  expect(editor.current.version.version).toBe(2)
  expect(notifications).toEqual([
    expect.objectContaining({ kind: 'edit', version: 2, roundId: null }),
  ])
  expect(screen.queryByRole('alert')).toBeNull()
})

it('抓手模式不抢画板弹层里的输入焦点', () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  showWorkspace()
  fireEvent.click(screen.getByRole('button', { name: '抓手' }))
  fireEvent.click(screen.getByRole('button', { name: '设置画板：宽屏首页' }))
  const width = screen.getByRole('spinbutton', { name: '宽度' })
  width.focus()
  expect(fireEvent.pointerDown(width, { button: 0, clientX: 24, clientY: 24 })).toBe(true)
  expect(document.activeElement).toBe(width)
})

it('画板表单打开后收到新版本时，保留未保存布局而不提交到新版本', () => {
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}))
  const view = showWorkspace()
  fireEvent.click(screen.getByRole('button', { name: '设置画板：宽屏首页' }))
  const width = screen.getByRole('spinbutton', { name: '宽度' })
  fireEvent.change(width, { target: { value: '880' } })
  view.update(
    workspace(
      detailFor(
        2,
        JSON.stringify({
          ...design,
          boards: design.boards.map((board) =>
            board.id === 'desktop' ? { ...board, viewport: { width: 1000, height: 900 } } : board,
          ),
        }),
      ),
    ),
  )
  expect((screen.getByRole('spinbutton', { name: '宽度' }) as HTMLInputElement).value).toBe('880')
  fireEvent.click(screen.getByRole('button', { name: '应用' }))

  const alert = screen.getByRole('alert')
  expect(within(alert).getByText('未保存的改动已保留（基于 v1）。')).toBeTruthy()
  expect(within(alert).getByRole('button', { name: '下载草稿' })).toBeTruthy()
  expect(screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页').width).toBe('1000')
  expect(
    request.mock.calls.some(
      ([path, init]) => path === '/api/v1/artifacts' && init?.method === 'POST',
    ),
  ).toBe(false)
})

it('撤销和重做只重放本会话操作，其他作者推进头版本后停止', async () => {
  const editor = showEditableWorkspace(detailFor())
  const board = () => screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页')
  fireEvent.click(screen.getByRole('button', { name: '设置画板：宽屏首页' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '宽度' }), { target: { value: '900' } })
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await waitFor(() => expect(board().width).toBe('900'))
  expect(editor.submittedVersion).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: '撤销画布编辑' }))
  await waitFor(() => expect(board().width).toBe('1440'))
  expect(editor.submittedVersion).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: '重做画布编辑' }))
  await waitFor(() => expect(board().width).toBe('900'))
  expect(editor.submittedVersion).toBe(3)

  editor.receiveAgentSource(
    JSON.stringify({
      ...design,
      boards: design.boards.map((entry) =>
        entry.id === 'desktop' ? { ...entry, viewport: { width: 1000, height: 700 } } : entry,
      ),
    }),
  )
  const undo = screen.getByRole('button', { name: '撤销画布编辑' })
  expect(undo.hasAttribute('disabled')).toBe(true)
  fireEvent.click(undo)
  expect(board().width).toBe('1000')
  expect(editor.submittedVersion).toBe(3)
})

it('拖动只预览，取消不发布，移动或调整大小完成时各发布一次', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
  const title = screen.getByRole('button', { name: '宽屏首页' })
  const frame = () => screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页')
  const outer = title.closest<HTMLElement>('.artifact-canvas-board')
  if (!outer) throw new Error('桌面画板夹具不可用')
  const initialLeft = Number.parseFloat(outer.style.left)
  const first = { button: 0, clientX: 12, clientY: 20 }
  fireEvent.pointerDown(title, first)
  fireEvent.pointerMove(title, { clientX: 68, clientY: 53 })
  expect(Number.parseFloat(outer.style.left)).toBe(initialLeft + 56)
  expect(editor.submittedVersion).toBeUndefined()
  fireEvent.pointerCancel(title)
  expect(Number.parseFloat(outer.style.left)).toBe(initialLeft)
  expect(editor.current.version.version).toBe(1)

  fireEvent.pointerDown(title, first)
  fireEvent.pointerMove(title, { clientX: 72, clientY: 54 })
  fireEvent.pointerUp(title, { clientX: 72, clientY: 54 })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].position).toEqual({ x: 60, y: 34 })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  const resize = await screen.findByRole('button', { name: '拖动调整尺寸：宽屏首页' })
  fireEvent.pointerDown(resize, first)
  fireEvent.pointerMove(resize, { clientX: 76, clientY: 64 })
  expect(
    Number.parseFloat(frame().closest<HTMLElement>('.artifact-canvas-board')?.style.width ?? ''),
  ).toBe(1504)
  expect(frame().width).toBe('1440')
  expect(editor.current.version.version).toBe(2)
  fireEvent.pointerUp(resize, { clientX: 76, clientY: 64 })
  await waitFor(() => expect(frame().width).toBe('1504'))
  expect(editor.current.version.version).toBe(3)
  expect(frame().height).toBe('944')
})

it('Shift 多选可一次对齐并分组，重选组成员时联动选择', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(
    detailFor(
      1,
      JSON.stringify({
        ...design,
        boards: design.boards.map((board) =>
          board.id === 'desktop'
            ? { ...board, position: { x: -40, y: 0 } }
            : board.id === 'mobile'
              ? { ...board, position: { x: 140, y: 310 } }
              : board,
        ),
      }),
    ),
  )
  const desktop = () => screen.getByRole('button', { name: '宽屏首页' })
  const mobile = () => screen.getByRole('button', { name: '手机首页' })
  fireEvent.click(desktop())
  fireEvent.click(mobile(), { shiftKey: true })
  expect(desktop().getAttribute('aria-pressed')).toBe('true')
  expect(mobile().getAttribute('aria-pressed')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: '排列画板' }))
  fireEvent.click(screen.getByRole('button', { name: '左对齐' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  const doc = () => JSON.parse(editor.current.version.source)
  expect(doc().boards[1].position).toEqual({ x: -40, y: 310 })
  expect(doc().boards[1].viewport).toEqual({ width: 390, height: 844 })

  fireEvent.click(screen.getByRole('button', { name: '排列画板' }))
  fireEvent.click(screen.getByRole('button', { name: '分组画板' }))
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(doc().boards[0].layoutGroup).toEqual(expect.any(String))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  expect(doc().boards[1].layoutGroup).toBe(doc().boards[0].layoutGroup)
  fireEvent.click(desktop())
  expect(mobile().getAttribute('aria-pressed')).toBe('true')
  const title = desktop()
  fireEvent.pointerDown(title, { button: 0, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(title, { clientX: 80, clientY: 35 })
  expect(editor.current.version.version).toBe(3)
  fireEvent.pointerUp(title, { clientX: 80, clientY: 35 })
  await waitFor(() => expect(editor.current.version.version).toBe(4))
  expect(doc().boards[0].position).toEqual({ x: 30, y: 25 })
  expect(doc().boards[1].position).toEqual({ x: 30, y: 335 })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )

  fireEvent.click(screen.getByRole('button', { name: '排列画板' }))
  fireEvent.click(screen.getByRole('button', { name: '取消分组' }))
  await waitFor(() => expect(editor.current.version.version).toBe(5))
  expect(doc().boards[0].layoutGroup).toBeUndefined()
  expect(doc().boards[1].layoutGroup).toBeUndefined()
  fireEvent.click(desktop())
  expect(mobile().getAttribute('aria-pressed')).toBe('false')
})
