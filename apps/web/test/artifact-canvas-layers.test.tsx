// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import {
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showEditableWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('检查器只编排原生图层，同画板选区在发布后重绑，旧基准草稿不覆盖新头版本', async () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            designLayers: [
              { id: 'note', kind: 'note', text: '发版便签', x: 40, y: 40, width: 100, height: 80 },
              { id: 'frame', kind: 'rectangle', x: 160, y: 110, width: 70, height: 60 },
            ],
          }
        : board,
    ),
  })
  const editor = showEditableWorkspace(detailFor(1, source))
  fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const snapshot = (version: number) => {
    frame.receive({
      type: 'inspect.layers.snapshot',
      version,
      truncated: false,
      layers: [
        {
          id: `${version}:h1`,
          tag: 'h1',
          selector: 'h1',
          sourceLoc: '1:1',
          label: '网页标题',
          width: 500,
          height: 45,
        },
        {
          id: `${version}:note`,
          tag: 'div',
          selector: 'aside > div:nth-child(1)',
          designId: 'note',
          label: '发版便签',
          width: 100,
          height: 80,
        },
        {
          id: `${version}:frame`,
          tag: 'div',
          selector: 'aside > div:nth-child(2)',
          designId: 'frame',
          label: '矩形',
          width: 70,
          height: 60,
        },
      ],
    })
  }
  const layer = (name: string) => within(inspector).getByRole('button', { name })
  snapshot(1)
  fireEvent.click(layer('网页标题'))
  expect(within(inspector).queryByRole('region', { name: '图层布局' })).toBeNull()
  fireEvent.click(layer('发版便签'))
  fireEvent.click(layer('矩形'), { shiftKey: true })
  expect(layer('发版便签').getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(layer('顶端对齐'))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  snapshot(2)
  const afterAlign = JSON.parse(editor.current.version.source)
  expect(afterAlign.boards[0].designLayers.map(({ y }: { y: number }) => y)).toEqual([40, 40])
  expect(afterAlign.boards[0].html).toBe(design.boards[0].html)
  expect(layer('矩形').getAttribute('aria-pressed')).toBe('true')
  expect(layer('发版便签').getAttribute('aria-pressed')).toBe('true')
  const width = () => within(inspector).getByRole<HTMLInputElement>('spinbutton', { name: '宽度' })
  fireEvent.change(width(), { target: { value: '82' } })
  afterAlign.boards[0].designLayers[1].width = 92
  editor.receiveAgentSource(JSON.stringify(afterAlign))
  snapshot(3)
  expect(width().value).toBe('82')
  fireEvent.blur(width())
  expect(await screen.findByText('作品已更新，未覆盖新版本。')).toBeTruthy()
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[1].width).toBe(92)
})

it('拖出矩形只预览，松开按画板固有坐标保存并可撤销重做', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
  fireEvent.click(screen.getByRole('button', { name: '形状' }))
  fireEvent.click(screen.getByRole('button', { name: '绘制矩形' }))
  const surface = screen.getByRole('button', { name: '在宽屏首页绘制矩形' })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 720, 450))
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 120, clientY: 80 })
  const scale = screen.getByLabelText('画布缩放比例').textContent
  fireEvent.wheel(screen.getByRole('region', { name: '画布' }), { deltaY: -300 })
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(scale)
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: 190, clientY: 140 })
  expect(editor.current.version.version).toBe(1)
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: 190, clientY: 140 })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const layers = () => JSON.parse(editor.current.version.source).boards[0].designLayers
  expect(layers()).toEqual([
    expect.objectContaining({ kind: 'rectangle', x: 40, y: 60, width: 140, height: 120 }),
  ])
  expect(screen.getByRole('button', { name: '选择' }).getAttribute('aria-pressed')).toBe('true')
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '撤销画布编辑' }))
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(layers()).toBeUndefined()
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '重做画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '重做画布编辑' }))
  await waitFor(() => expect(editor.current.version.version).toBe(4))
  expect(layers()[0]).toMatchObject({ kind: 'rectangle', x: 40, y: 60, width: 140, height: 120 })
})

it('长笔迹达到采样上限后仍保存新转折', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
  fireEvent.click(screen.getByRole('button', { name: '画笔' }))
  const surface = screen.getByRole('button', { name: '在宽屏首页绘制笔迹' })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))
  fireEvent.pointerDown(surface, { clientX: 10, clientY: 10 })
  act(() => {
    for (let i = 0; i < 2050; i += 1) {
      fireEvent.pointerMove(surface, { clientX: i % 2 ? 10 : 20, clientY: 10 })
    }
    fireEvent.pointerMove(surface, { clientX: 90, clientY: 220 })
    fireEvent.pointerUp(surface, { clientX: 120, clientY: 50 })
  })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const [stroke] = JSON.parse(editor.current.version.source).boards[0].designLayers
  expect(stroke.points.length).toBeLessThanOrEqual(2048)
  const tail = stroke.points
    .slice(-2)
    .map(([x, y]: [number, number]) => [
      Math.round(stroke.x + x * stroke.width),
      Math.round(stroke.y + y * stroke.height),
    ])
  expect(tail).toEqual([
    [90, 220],
    [120, 50],
  ])
})

it('双击已有便签只修改同画板原生对象的文本并保留版本基准', async () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            designLayers: [
              { id: 'note', kind: 'note', text: '原文', x: 10, y: 30, width: 200, height: 90 },
            ],
          }
        : board,
    ),
  })
  const editor = showEditableWorkspace(detailFor(1, source))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const hit = screen.getByRole('button', { name: '选择画板：宽屏首页' })
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 720, 450))
  fireEvent.doubleClick(hit, { clientX: 135, clientY: 85 })
  const request = frame.post.mock.calls.find(
    ([message]) => message.type === 'inspect.at' && message.purpose === 'text',
  )?.[0]
  expect(request).toMatchObject({ version: 1, x: 70, y: 70 })
  frame.receive({
    type: 'inspect.target',
    purpose: 'text',
    version: 1,
    requestId: request.requestId,
    element: { blockId: 'design-layer:note', selector: 'aside > div', textPreview: '原文' },
  })
  const text = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '文字' })
  expect(text.value).toBe('原文')
  fireEvent.change(text, { target: { value: '版本化便签' } })
  expect(editor.current.version.version).toBe(1)
  const editorDialog = screen.getByRole('dialog', { name: '编辑文字' })
  fireEvent.click(within(editorDialog).getByRole('button', { name: '保存' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers).toEqual([
    { id: 'note', kind: 'note', text: '版本化便签', x: 10, y: 30, width: 200, height: 90 },
  ])
  expect(editor.submittedVersion).toBe(1)
})
