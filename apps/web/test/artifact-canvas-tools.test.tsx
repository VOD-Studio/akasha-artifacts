// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  design,
  detailFor,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('空白处拖框选中多张画板且不触发试玩，缩放不切换当前工具', () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  showWorkspace()
  const canvas = screen.getByRole('region', { name: '画布' })
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2400, 2100))

  // 初始缩放下两张画板都在视口内，拖框覆盖两张画板区域。
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 2300, clientY: 1900 })
  expect(screen.getByTestId('canvas-marquee')).toBeTruthy()
  fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 2300, clientY: 1900 })
  fireEvent.click(canvas)

  expect(screen.getByRole('button', { name: '宽屏首页' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '手机首页' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByTitle('画板内容：宽屏首页').hasAttribute('inert')).toBe(true)

  // 切到矩形工具后通过快捷键与滚轮缩放，当前工具保持不变。
  fireEvent.keyDown(document.body, { key: 'r', code: 'KeyR' })
  expect(screen.getByRole('button', { name: '形状' }).getAttribute('aria-pressed')).toBe('true')
  const beforeZoom = screen.getByLabelText('画布缩放比例').textContent
  fireEvent.keyDown(document.body, { key: '+' })
  expect(screen.getByLabelText('画布缩放比例').textContent).not.toBe(beforeZoom)
  expect(screen.getByRole('button', { name: '形状' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.wheel(canvas, { deltaY: -120, ctrlKey: true, clientX: 400, clientY: 300 })
  expect(screen.getByRole('button', { name: '形状' }).getAttribute('aria-pressed')).toBe('true')
})

it('按 A 键在指针拖出的坐标与尺寸放置新画板', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
  fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' })
  expect(screen.getByRole('button', { name: '添加画板' }).getAttribute('aria-pressed')).toBe('true')
  const placer = screen.getByTestId('canvas-artboard-placer')
  vi.spyOn(placer, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2400, 2100))

  fireEvent.pointerDown(placer, { button: 0, pointerId: 1, clientX: 200, clientY: 150 })
  fireEvent.pointerMove(placer, { pointerId: 1, clientX: 600, clientY: 450 })
  expect(screen.getByTestId('canvas-artboard-preview')).toBeTruthy()
  fireEvent.pointerUp(placer, { pointerId: 1, clientX: 600, clientY: 450 })

  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const boards = JSON.parse(editor.current.version.source).boards
  const created = boards.at(-1)
  expect(created.title).toBe('画板 3')
  expect(created.position).toBeDefined()
  expect(created.viewport.width).toBeGreaterThanOrEqual(32)
  expect(created.viewport.height).toBeGreaterThanOrEqual(32)
})

it('椭圆跨出画板边界仍归属起笔画板并在画布外可见，纯空白区不保存游离图层', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())

  // 在宽屏首页（1440×900）起笔并拖出右边界之外。
  fireEvent.keyDown(document.body, { key: 'o', code: 'KeyO' })
  const surface = screen.getByRole('button', { name: '在宽屏首页绘制椭圆' })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 720, 450))
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 780, clientY: 150 })
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: 880, clientY: 230 })
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: 880, clientY: 230 })

  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const desktopLayers = JSON.parse(editor.current.version.source).boards[0].designLayers
  expect(desktopLayers).toHaveLength(1)
  expect(desktopLayers[0]).toMatchObject({
    kind: 'ellipse',
    x: 1360,
    y: 100,
    width: 200,
    height: 160,
  })
  expect(desktopLayers[0].x + desktopLayers[0].width).toBeGreaterThan(1440)
  // 画板外溢出渲染层可见。
  expect(screen.getByTestId('board-overflow-layers-desktop')).toBeTruthy()
  expect(JSON.parse(editor.current.version.source).boards[1].designLayers).toBeUndefined()

  // 在纯空白画布区域绘制矩形，不与任何画板相交，应拒绝落盘并提示。
  fireEvent.keyDown(document.body, { key: 'r', code: 'KeyR' })
  const blank = screen.getByTestId('canvas-blank-drawing')
  vi.spyOn(blank, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2400, 2100))
  fireEvent.pointerDown(blank, { button: 0, pointerId: 2, clientX: 2320, clientY: 2020 })
  fireEvent.pointerMove(blank, { pointerId: 2, clientX: 2380, clientY: 2080 })
  fireEvent.pointerUp(blank, { pointerId: 2, clientX: 2380, clientY: 2080 })
  expect(
    await screen.findByText('空白画布区域不保存游离图层，请落入画板或跨越画板边界。'),
  ).toBeTruthy()
  expect(editor.current.version.version).toBe(2)
})

it('便签区别于普通文本并在落点打开输入，保存后各自保留正确类型', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(
    detailFor(1, JSON.stringify({ ...design, boards: [design.boards[0]] })),
  )
  fireEvent.keyDown(document.body, { key: 'n', code: 'KeyN' })
  const noteSurface = screen.getByRole('button', { name: '在宽屏首页添加便签' })
  vi.spyOn(noteSurface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 720, 450))
  fireEvent.pointerDown(noteSurface, { button: 0, pointerId: 1, clientX: 50, clientY: 60 })
  fireEvent.pointerUp(noteSurface, { pointerId: 1, clientX: 50, clientY: 60 })
  const noteDialog = screen.getByRole('dialog', { name: '添加便签' })
  fireEvent.change(screen.getByRole('textbox', { name: '文字' }), { target: { value: '评审便签' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(noteDialog.isConnected).toBe(false)
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0]).toMatchObject({
    kind: 'note',
    text: '评审便签',
  })

  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.keyDown(document.body, { key: 't', code: 'KeyT' })
  const textSurface = screen.getByRole('button', { name: '在宽屏首页添加文本' })
  vi.spyOn(textSurface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 720, 450))
  fireEvent.pointerDown(textSurface, { button: 0, pointerId: 2, clientX: 200, clientY: 100 })
  fireEvent.pointerUp(textSurface, { pointerId: 2, clientX: 200, clientY: 100 })
  expect(screen.getByRole('dialog', { name: '添加文本' })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: '文字' }), { target: { value: '普通文案' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[1]).toMatchObject({
    kind: 'text',
    text: '普通文案',
  })
})
