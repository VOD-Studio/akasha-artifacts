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

function sourceWithNativeLayers() {
  return JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            html: '<section><p>页面正文</p><p>次要说明</p></section>',
            designLayers: [
              {
                id: 'headline',
                kind: 'text',
                x: 40,
                y: 60,
                width: 240,
                height: 48,
                text: '核心标题',
                color: '#202733',
                fontSize: 16,
                fontWeight: 'normal',
                textAlign: 'left',
              },
              {
                id: 'card',
                kind: 'rectangle',
                x: 320,
                y: 80,
                width: 160,
                height: 100,
                color: 'blue',
              },
            ],
          }
        : board,
    ),
  })
}

function sendNativeLayersSnapshot(frame: ReturnType<typeof sandbox>, version: number) {
  frame.receive({
    type: 'inspect.layers.snapshot',
    version,
    truncated: false,
    layers: [
      {
        id: `v${version}:headline`,
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'headline',
        label: '核心标题',
        width: 240,
        height: 48,
      },
      {
        id: `v${version}:card`,
        tag: 'div',
        selector: 'aside > div:nth-of-type(2)',
        designId: 'card',
        label: '矩形',
        width: 160,
        height: 100,
      },
    ],
  })
}

it('文字选区工具栏支持 F6/Esc 焦点往返、自定义低对比度色提示与单版本撤销', async () => {
  stubResizeObserver()
  const editor = showEditableWorkspace(detailFor(1, sourceWithNativeLayers()))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  sendNativeLayersSnapshot(frame, 1)

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  const toolbar = screen.getByTestId('selection-toolbar')

  // 文本浮栏包含样式、颜色、对比度、对齐和批注。
  expect(within(toolbar).getByRole('button', { name: '编辑文字' })).toBeTruthy()
  expect(within(toolbar).getByRole('combobox', { name: '字号' })).toBeTruthy()
  expect(within(toolbar).getByRole('combobox', { name: '字重' })).toBeTruthy()
  expect(within(toolbar).getByRole('button', { name: '文字颜色' })).toBeTruthy()
  expect(within(toolbar).getByRole('button', { name: '文字居中' })).toBeTruthy()
  expect(within(toolbar).getByRole('button', { name: '批注' })).toBeTruthy()
  expect(screen.getByTestId('selection-contrast-hint').textContent).toContain('AAA')

  // F6 从选中对象进入选区工具栏，Esc 回到选中对象且不清除选区。
  fireEvent.keyDown(layerFocus, { key: 'F6' })
  expect(toolbar.contains(document.activeElement)).toBe(true)
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
  expect(document.activeElement).toBe(layerFocus)
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('v1:headline')

  // 修改对齐方式提交 1 个版本。
  fireEvent.click(within(toolbar).getByRole('button', { name: '文字居中' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0].textAlign).toBe(
    'center',
  )

  // 通过颜色面板输入低对比度自定义色并应用，浮栏实时播报 WCAG 低对比度提示。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  sendNativeLayersSnapshot(frame, 2)
  fireEvent.click(within(toolbar).getByRole('button', { name: '文字颜色' }))
  const hexInput = screen.getByRole('textbox', { name: '自定义颜色' })
  fireEvent.change(hexInput, { target: { value: '#9ca3af' } })
  fireEvent.click(screen.getByRole('button', { name: '应用' }))

  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0].color).toBe('#9ca3af')
  expect(screen.getByTestId('selection-contrast-hint').textContent).toContain('对比度偏低')

  // 撤销颜色修改后对比度恢复 AAA。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '撤销画布编辑' }))
  await waitFor(() => expect(editor.current.version.version).toBe(4))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0].color).toBe('#202733')
  expect(screen.getByTestId('selection-contrast-hint').textContent).toContain('AAA')
})

it('形状浮栏在检查器「属性」页签去重但不整条隐藏，切到「源码」页签时填充与 F6 均不受阻挡', async () => {
  stubResizeObserver()
  const editor = showEditableWorkspace(detailFor(1, sourceWithNativeLayers()))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  sendNativeLayersSnapshot(frame, 1)

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  // Tab 切换到第二个原生图层（矩形形状）。
  fireEvent.keyDown(layerFocus, { key: 'Tab' })
  expect(useSelectionStore.getState().layersByArtifact[artifact.publicId]?.id).toBe('v1:card')

  const toolbar = screen.getByTestId('selection-toolbar')
  expect(within(toolbar).getByRole('button', { name: '填充' })).toBeTruthy()
  expect(within(toolbar).getByRole('button', { name: '水平翻转' })).toBeTruthy()
  expect(within(toolbar).getByRole('button', { name: '批注' })).toBeTruthy()
  expect(within(toolbar).queryByRole('combobox', { name: '字号' })).toBeNull()

  // 打开右侧检查器并停留在「属性」页签：不整条隐藏浮栏，但隐藏与「属性」重复的填充与批注。
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  expect(screen.getByTestId('selection-toolbar')).toBeTruthy()
  expect(within(toolbar).queryByRole('button', { name: '填充' })).toBeNull()
  expect(within(toolbar).queryByRole('button', { name: '批注' })).toBeNull()
  expect(within(toolbar).getByRole('button', { name: '水平翻转' })).toBeTruthy()

  // 切换到「源码」页签：形状「填充」与「批注」恢复，且 F6 仍直达选区工具栏不被抽屉抢占。
  const sourceTab = within(inspector).getByRole('tab', { name: '源码' })
  fireEvent.mouseDown(sourceTab)
  fireEvent.click(sourceTab)
  await waitFor(() => expect(within(toolbar).getByRole('button', { name: '填充' })).toBeTruthy())
  expect(within(toolbar).getByRole('button', { name: '批注' })).toBeTruthy()

  layerFocus.focus()
  fireEvent.keyDown(layerFocus, { key: 'F6' })
  expect(toolbar.contains(document.activeElement)).toBe(true)
  expect(inspector.contains(document.activeElement)).toBe(false)

  // 从浮栏「填充」快捷修改形状颜色生成 1 个新版本。
  fireEvent.click(within(toolbar).getByRole('button', { name: '填充' }))
  fireEvent.click(screen.getByRole('button', { name: '玫红' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[1].color).toBe('rose')
})

it('只读分享模式仅展示检查信息与对比度，不提供写入操作且不发送保存请求', () => {
  stubResizeObserver()
  const readOnlyDetail = {
    ...detailFor(1, sourceWithNativeLayers()),
    access: { role: 'view' as const, expiresAt: '2099-01-01T00:00:00.000Z' },
  }
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  showWorkspace(readOnlyDetail)

  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  sendNativeLayersSnapshot(frame, 1)

  const layerFocus = screen.getByTestId('canvas-layer-focus')
  const toolbar = screen.getByTestId('selection-toolbar')
  expect(toolbar.textContent).toContain('16px')
  expect(toolbar.textContent).toContain('#202733')
  expect(screen.getByTestId('selection-contrast-hint').textContent).toContain('AAA')
  expect(within(toolbar).queryByRole('button', { name: '编辑文字' })).toBeNull()
  expect(within(toolbar).queryByRole('button', { name: '批注' })).toBeNull()
  expect(within(toolbar).getByRole('button', { name: '文字居中' }).hasAttribute('disabled')).toBe(
    true,
  )

  // 只读模式同样可通过 F6 进入工具栏并 Esc 返回选中对象。
  fireEvent.keyDown(layerFocus, { key: 'F6' })
  expect(document.activeElement).toBe(toolbar)
  fireEvent.keyDown(toolbar, { key: 'Escape' })
  expect(document.activeElement).toBe(layerFocus)

  const writeCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
  expect(writeCalls).toEqual([])
  fetchSpy.mockRestore()
})

it('流内静态文字浮栏支持展示对比度、对齐修改与流顺序重排', async () => {
  stubResizeObserver()
  const editor = showEditableWorkspace(detailFor(1, sourceWithNativeLayers()))
  const mockFetch = vi.mocked(fetch)
  const previous = mockFetch.getMockImplementation()
  const previewOps: unknown[] = []
  mockFetch.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.includes('/visual-edit?') && (!init?.method || init.method === 'GET')) {
      return Response.json({
        target: {
          tagName: 'p',
          text: '页面正文',
          className: 'text-slate-900',
          order: {
            parentLoc: '1:1',
            siblings: [
              { loc: '1:10', label: '页面正文' },
              { loc: '1:25', label: '次要说明' },
            ],
          },
        },
      })
    }
    if (url.includes('/visual-edit/preview') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      previewOps.push(body.op)
      const updated = JSON.parse(editor.current.version.source)
      updated.boards[0].html =
        '<section><p class="text-slate-900 text-center">页面正文</p><p>次要说明</p></section>'
      return Response.json({ source: JSON.stringify(updated) })
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
        label: '页面正文',
        width: 240,
        height: 24,
      },
    ],
  })
  frame.receive({
    type: 'inspect.select',
    version: 1,
    layerId: 'p1',
    element: { selector: 'section > p:nth-of-type(1)' },
    presentation: {
      color: 'rgb(15, 23, 42)',
      backgroundColor: 'rgb(255, 255, 255)',
      fontSize: 16,
      fontWeight: 400,
      textAlign: 'left',
      isText: true,
    },
  })

  const toolbar = screen.getByTestId('selection-toolbar')
  await waitFor(() =>
    expect(within(toolbar).getByRole('button', { name: '下移一层' })).toBeTruthy(),
  )
  expect(screen.getByTestId('selection-contrast-hint').textContent).toContain('AAA')

  fireEvent.click(within(toolbar).getByRole('button', { name: '文字居中' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(previewOps).toEqual([
    { kind: 'className', loc: '1:10', value: 'text-slate-900 text-center' },
  ])
})
