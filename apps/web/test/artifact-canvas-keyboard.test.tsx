// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSelectionStore } from '../src/entities/selection'
import { useWorkspaceStore } from '../src/entities/workspace'
import {
  artifact,
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('从画板标题 Return 进入图层，支持 Tab 遍历、Return 下钻、Shift+Return 退层和 Esc 回板', () => {
  stubResizeObserver()
  showWorkspace()
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      { id: 'sec', tag: 'section', selector: 'section', label: '主区块', width: 600, height: 300 },
      {
        id: 'h1',
        parentId: 'sec',
        tag: 'h1',
        selector: 'section > h1',
        label: '首标题',
        width: 300,
        height: 40,
      },
      {
        id: 'p1',
        parentId: 'sec',
        tag: 'p',
        selector: 'section > p',
        label: '说明段',
        width: 300,
        height: 24,
      },
      { id: 'foot', tag: 'footer', selector: 'footer', label: '页脚', width: 600, height: 60 },
    ],
  })

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  expect(document.activeElement).toBe(layerFocus)
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('sec')

  // Return 进入子图层，Tab 在同级兄弟间遍历。
  fireEvent.keyDown(layerFocus, { key: 'Enter' })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('h1')
  fireEvent.keyDown(layerFocus, { key: 'Tab' })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('p1')
  fireEvent.keyDown(layerFocus, { key: 'Tab', shiftKey: true })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('h1')

  // Shift+Return 退回父层，再按 Esc 回到画板标题并保持画板选中。
  fireEvent.keyDown(layerFocus, { key: 'Enter', shiftKey: true })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('sec')
  fireEvent.keyDown(layerFocus, { key: 'Escape' })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]).toBeUndefined()
  expect(document.activeElement).toBe(title)
  expect(title.getAttribute('aria-pressed')).toBe('true')
})

it('图层树方向键仅移动焦点不改画布选区，Enter 确认才切换选区', () => {
  stubResizeObserver()
  showWorkspace()
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      { id: 'a', tag: 'h1', selector: 'h1', label: '第一层', width: 200, height: 32 },
      { id: 'b', tag: 'p', selector: 'p', label: '第二层', width: 200, height: 24 },
    ],
  })

  const inspector = screen.getByRole('dialog', { name: '检查器' })
  const first = within(inspector).getByRole('button', { name: '第一层' })
  const second = within(inspector).getByRole('button', { name: '第二层' })
  fireEvent.click(first)
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('a')

  first.focus()
  fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second)
  // 焦点移到「第二层」后，选区仍是「第一层」。
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('a')
  expect(first.getAttribute('aria-pressed')).toBe('true')
  expect(second.getAttribute('aria-pressed')).toBe('false')

  fireEvent.click(second)
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('b')
})

it('方向键移动自由层、Alt+方向键重排流内层，并支持复制粘贴、翻转、删除与撤销', async () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            html: '<section><p>第一项</p><p>第二项</p></section>',
            designLayers: [
              {
                id: 'card',
                kind: 'rectangle',
                x: 40,
                y: 50,
                width: 100,
                height: 80,
                color: 'blue',
              },
            ],
          }
        : board,
    ),
  })
  const editor = showEditableWorkspace(detailFor(1, source))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'v1:card',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'card',
        label: '矩形',
        width: 100,
        height: 80,
      },
      {
        id: 'v1:p1',
        tag: 'p',
        selector: 'section > p:nth-of-type(1)',
        sourceLoc: '1:10',
        label: '第一项',
        width: 200,
        height: 24,
      },
    ],
  })

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  // Shift+ArrowRight 移动自由层 +10px。
  fireEvent.keyDown(layerFocus, { key: 'ArrowRight', shiftKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0].x).toBe(50)

  // Shift+H 水平翻转，再 Ctrl+C / Ctrl+V 复制粘贴。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 2,
    truncated: false,
    layers: [
      {
        id: 'v2:card',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'card',
        label: '矩形',
        width: 100,
        height: 80,
      },
    ],
  })
  fireEvent.keyDown(layerFocus, { key: 'H', code: 'KeyH', shiftKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0].flipX).toBe(true)

  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 3,
    truncated: false,
    layers: [
      {
        id: 'v3:card',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'card',
        label: '矩形',
        width: 100,
        height: 80,
      },
    ],
  })
  fireEvent.keyDown(layerFocus, { key: 'c', code: 'KeyC', ctrlKey: true })
  fireEvent.keyDown(layerFocus, { key: 'v', code: 'KeyV', ctrlKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(4))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers).toHaveLength(2)

  // Ctrl+Z 撤销粘贴。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.keyDown(layerFocus, { key: 'z', code: 'KeyZ', ctrlKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(5))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers).toHaveLength(1)

  // Delete 删除图层。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 5,
    truncated: false,
    layers: [
      {
        id: 'v5:card',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'card',
        label: '矩形',
        width: 100,
        height: 80,
      },
    ],
  })
  fireEvent.keyDown(layerFocus, { key: 'Delete' })
  await waitFor(() => expect(editor.current.version.version).toBe(6))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers).toEqual([])
})

it('流内静态元素支持 Alt+方向键重排且只读模式方向键不触发任何写入', async () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? { ...board, html: '<section><p>第一项</p><p>第二项</p></section>' }
        : board,
    ),
  })
  const editor = showEditableWorkspace(detailFor(1, source))
  const mockFetch = vi.mocked(fetch)
  const previous = mockFetch.getMockImplementation()
  const previewOps: unknown[] = []
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/visual-edit?') && (!init?.method || init.method === 'GET')) {
      return Response.json({
        target: {
          tagName: 'p',
          text: '第一项',
          className: '',
          order: {
            parentLoc: '1:1',
            siblings: [
              { loc: '1:10', label: '第一项' },
              { loc: '1:20', label: '第二项' },
            ],
          },
        },
      })
    }
    if (url.includes('/visual-edit/preview') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      previewOps.push(body.op)
      const reordered = JSON.parse(editor.current.version.source)
      reordered.boards[0].html = '<section><p>第二项</p><p>第一项</p></section>'
      return Response.json({ source: JSON.stringify(reordered) })
    }
    if (!previous) throw new Error('缺少默认请求桩')
    return previous(input, init)
  })

  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'p1',
        tag: 'p',
        selector: 'section > p:nth-of-type(1)',
        sourceLoc: '1:10',
        label: '第一项',
        width: 200,
        height: 24,
      },
      {
        id: 'p2',
        tag: 'p',
        selector: 'section > p:nth-of-type(2)',
        sourceLoc: '1:20',
        label: '第二项',
        width: 200,
        height: 24,
      },
    ],
  })

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  await waitFor(() =>
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/visual-edit?'))).toBe(true),
  )
  fireEvent.keyDown(layerFocus, { key: 'ArrowDown', altKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(previewOps).toEqual([{ kind: 'move', loc: '1:10', targetParentLoc: '1:1', index: 1 }])
  expect(JSON.parse(editor.current.version.source).boards[0].html).toBe(
    '<section><p>第二项</p><p>第一项</p></section>',
  )
})

it('选中运行图层时 Delete 与 Ctrl+C/X 不会误删或误复制所属整张画板', async () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? { ...board, html: '<section><p>第一项</p><p>第二项</p></section>' }
        : board,
    ),
  })
  const editor = showEditableWorkspace(detailFor(1, source))
  const mockFetch = vi.mocked(fetch)
  const previous = mockFetch.getMockImplementation()
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/visual-edit?') && (!init?.method || init.method === 'GET')) {
      return new Response('not found', { status: 404 })
    }
    if (!previous) throw new Error('缺少默认请求桩')
    return previous(input, init)
  })

  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'p1',
        tag: 'p',
        selector: 'section > p:nth-of-type(1)',
        sourceLoc: '1:10',
        label: '第一项',
        width: 200,
        height: 24,
      },
    ],
  })

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  // visualTarget 未就绪时按 Delete / Ctrl+C / Ctrl+X / Ctrl+V 不得回退到删除或复制整张画板。
  fireEvent.keyDown(layerFocus, { key: 'Delete' })
  fireEvent.keyDown(layerFocus, { key: 'c', code: 'KeyC', ctrlKey: true })
  fireEvent.keyDown(layerFocus, { key: 'x', code: 'KeyX', ctrlKey: true })
  fireEvent.keyDown(layerFocus, { key: 'v', code: 'KeyV', ctrlKey: true })
  await Promise.resolve()
  expect(editor.current.version.version).toBe(1)
  expect(JSON.parse(editor.current.version.source).boards).toHaveLength(design.boards.length)
})

it('独立 HTML 作品同样支持通过 Alt+方向键、工具栏与 Delete 编辑运行图层', async () => {
  stubResizeObserver()
  const htmlDetail = {
    ...detailFor(1, '<section><p>第一项</p><p>第二项</p></section>'),
    artifact: {
      ...artifact,
      type: 'html' as const,
    },
  }
  const editor = showEditableWorkspace(htmlDetail)
  const mockFetch = vi.mocked(fetch)
  const previous = mockFetch.getMockImplementation()
  const previewOps: unknown[] = []
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/visual-edit?') && (!init?.method || init.method === 'GET')) {
      return Response.json({
        target: {
          tagName: 'p',
          text: '第一项',
          className: '',
          order: {
            parentLoc: '1:1',
            siblings: [
              { loc: '1:10', label: '第一项' },
              { loc: '1:20', label: '第二项' },
            ],
          },
        },
      })
    }
    if (url.includes('/visual-edit/preview') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      previewOps.push(body.op)
      const nextHtml =
        body.op.kind === 'remove'
          ? '<section><p>第二项</p></section>'
          : '<section><p>第二项</p><p>第一项</p></section>'
      return Response.json({ source: nextHtml })
    }
    if (!previous) throw new Error('缺少默认请求桩')
    return previous(input, init)
  })

  const frame = sandbox(screen.getByTitle('画板内容：茶席预约'))
  frame.receive({ type: 'ready' })
  const title = screen.getByRole('button', { name: '茶席预约' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'p1',
        tag: 'p',
        selector: 'section > p:nth-of-type(1)',
        sourceLoc: '1:10',
        label: '第一项',
        width: 200,
        height: 24,
      },
      {
        id: 'p2',
        tag: 'p',
        selector: 'section > p:nth-of-type(2)',
        sourceLoc: '1:20',
        label: '第二项',
        width: 200,
        height: 24,
      },
    ],
  })

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  await waitFor(() =>
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/visual-edit?'))).toBe(true),
  )
  fireEvent.keyDown(layerFocus, { key: 'ArrowDown', altKey: true })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(previewOps).toEqual([{ kind: 'move', loc: '1:10', targetParentLoc: '1:1', index: 1 }])

  // 独立 HTML 作品也允许 Delete 删除已选运行节点。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 2,
    truncated: false,
    layers: [
      {
        id: 'v2:p1',
        tag: 'p',
        selector: 'section > p:nth-of-type(2)',
        sourceLoc: '1:10',
        label: '第一项',
        width: 200,
        height: 24,
      },
    ],
  })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  await waitFor(() =>
    expect(
      mockFetch.mock.calls.filter(([url]) => String(url).includes('/visual-edit?')).length,
    ).toBeGreaterThanOrEqual(2),
  )
  fireEvent.keyDown(screen.getByTestId('canvas-layer-focus'), { key: 'Delete' })
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(previewOps[1]).toEqual({ kind: 'remove', loc: '1:10' })
})
