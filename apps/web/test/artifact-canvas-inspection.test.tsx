// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { TopBar } from '../src/widgets/TopBar'
import {
  artifact,
  detailFor,
  sandbox,
  setupCanvasTest,
  showWorkspace,
  stubResizeObserver,
  workspace,
} from './canvas-test-fixture'

setupCanvasTest()

it('从独立检查器选择其他页面的画板并查看固定版本的真实源码', () => {
  stubResizeObserver()
  const fixed = detailFor()
  const next = detailFor(2)
  const live = next.artifact
  const versions = [fixed.version, next.version]
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (number: 1 | 2) => (
    <QueryClientProvider client={client}>
      <TopBar
        artifact={live}
        version={number === 1 ? fixed.version : next.version}
        versions={versions}
        onBackToLibrary={() => {}}
        onSelectVersion={() => {}}
      />
      <ArtifactWorkspace
        detail={{ ...(number === 1 ? fixed : next), artifact: live }}
        versions={versions}
        fixedVersion={number}
        sandboxOrigin="http://127.0.0.1:24331"
      />
    </QueryClientProvider>
  )
  const view = render(tree(1))
  fireEvent.click(screen.getByRole('button', { name: '检查器' }))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  expect(within(inspector).getByText('选择画板以查看属性')).toBeTruthy()
  fireEvent.click(within(inspector).getByText('状态'))
  fireEvent.click(within(inspector).getByRole('button', { name: '预约完成' }))

  const canvas = screen.getByRole('region', { name: '画布' })
  expect(within(canvas).getByTitle('画板内容：预约完成')).toBeTruthy()
  expect(within(inspector).getByText('1280 × 800')).toBeTruthy()
  expect(within(inspector).getByText('#ffffff')).toBeTruthy()
  expect(within(inspector).queryByRole('button', { name: '保存' })).toBeNull()
  fireEvent.keyDown(within(inspector).getByRole('tab', { name: '源码' }), { key: 'Enter' })
  expect(within(inspector).getByText(/"description":"已确认时段"/)).toBeTruthy()
  expect(within(inspector).getByText('整份作品快照')).toBeTruthy()
  expect(within(inspector).queryByRole('button', { name: '编辑整份源码' })).toBeNull()
  expect(within(inspector).getByText('历史版本 · 只读')).toBeTruthy()

  fireEvent.click(within(inspector).getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog', { name: '检查器' })).toBeNull()
  expect(
    within(canvas).getByRole('button', { name: '预约完成' }).getAttribute('aria-pressed'),
  ).toBe('true')

  view.rerender(tree(2))
  const otherVersion = screen.getByRole('region', { name: '画布' })
  expect(within(otherVersion).getByTitle('画板内容：宽屏首页')).toBeTruthy()
  expect(within(otherVersion).queryByTitle('画板内容：预约完成')).toBeNull()
})

const tweakSource = JSON.stringify({
  boards: [
    {
      id: 'cover',
      title: '封面',
      html: '<h1>封面</h1>',
      tweaks: [{ id: 'speed', label: '速度', type: 'number', min: 0, max: 9, default: 3 }],
    },
  ],
})

it('参数确认绑定打开时的版本；协作者发布新版后不能把旧预览写回', async () => {
  stubResizeObserver()
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}))
  const view = showWorkspace(detailFor(1, tweakSource))
  fireEvent.click(screen.getByRole('button', { name: '封面' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const panel = within(screen.getByRole('dialog', { name: '检查器' }))
  fireEvent.keyDown(panel.getByRole('tab', { name: '画板参数' }), { key: 'Enter' })
  fireEvent.change(panel.getByRole('spinbutton', { name: '速度' }), { target: { value: '5' } })
  fireEvent.click(panel.getByRole('button', { name: '应用参数…' }))
  expect(await screen.findByRole('button', { name: '发布新版本' })).toBeTruthy()

  view.update(workspace(detailFor(2, tweakSource)))
  await waitFor(() => expect(screen.queryByRole('button', { name: '发布新版本' })).toBeNull())
  expect(
    request.mock.calls.some(
      ([url, options]) => options?.method === 'POST' && String(url).startsWith('/api/v1/artifacts'),
    ),
  ).toBe(false)
})

it.each(['分享编辑访客', '固定头版本'] as const)(
  '%s 可以预览和重置参数，但不能应用到版本',
  (entry) => {
    stubResizeObserver()
    const detail = detailFor(1, tweakSource)
    const view = showWorkspace(detail)
    view.update(
      <ArtifactWorkspace
        detail={
          entry === '分享编辑访客'
            ? { ...detail, access: { role: 'edit', expiresAt: '2099-01-01T00:00:00Z' } }
            : detail
        }
        versions={[detail.version]}
        fixedVersion={entry === '固定头版本' ? 1 : undefined}
        sandboxOrigin="http://127.0.0.1:24331"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '封面' }))
    act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
    const inspector = within(screen.getByRole('dialog', { name: '检查器' }))
    fireEvent.keyDown(inspector.getByRole('tab', { name: '画板参数' }), { key: 'Enter' })
    const speed = inspector.getByRole('spinbutton', { name: '速度' })
    fireEvent.change(speed, { target: { value: '7' } })
    expect(speed).toHaveProperty('value', '7')
    expect(inspector.queryByRole('button', { name: '应用参数…' })).toBeNull()
    fireEvent.click(inspector.getByRole('button', { name: '重置本板' }))
    expect(speed).toHaveProperty('value', '3')
  },
)

it('仅查看的分享链接允许读画板源码，不暴露保存或整稿编辑入口', () => {
  stubResizeObserver()
  const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}))
  showWorkspace({
    ...detailFor(),
    access: { role: 'view', expiresAt: '2026-11-25T09:00:00.000Z' },
  })
  fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = within(screen.getByRole('dialog', { name: '检查器' }))
  expect(inspector.getByText('1440 × 900')).toBeTruthy()
  expect(inspector.queryByRole('button', { name: '保存' })).toBeNull()
  expect(inspector.queryByRole('tab', { name: '画板参数' })).toBeNull()
  fireEvent.keyDown(inspector.getByRole('tab', { name: '源码' }), { key: 'Enter' })
  expect(inspector.getByText('画板源码')).toBeTruthy()
  expect(inspector.getByText('<h1>桌面预约</h1>')).toBeTruthy()
  expect(inspector.queryByRole('button', { name: '编辑整份源码' })).toBeNull()
  expect(
    request.mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
  ).toBe(true)
})

it('重复从检查器选择同一画板，会找回已被移出视口的选板', () => {
  stubResizeObserver()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(740)
  sessionStorage.setItem(
    `akasha:canvas:${artifact.publicId}/head`,
    JSON.stringify({
      pageId: 'reserve',
      pages: {
        reserve: { selected: 'desktop', camera: { x: 1800, y: 100, scale: 0.6, fit: null } },
      },
    }),
  )
  showWorkspace()
  const board = screen
    .getByRole('button', { name: '宽屏首页', pressed: true })
    .closest<HTMLElement>('.artifact-canvas-board')
  if (!board) throw new Error('宽屏画板夹具不可用')
  expect(Number.parseFloat(board.style.left)).toBeGreaterThan(1000)
  expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()

  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  expect(Number.parseFloat(board.style.left)).toBeGreaterThan(1000)
  fireEvent.click(within(inspector).getByRole('button', { name: '宽屏首页', pressed: true }))
  expect(Number.parseFloat(board.style.left)).toBeGreaterThanOrEqual(0)
  expect(screen.getByTitle('画板内容：宽屏首页')).toBeTruthy()
  expect(
    Number.parseFloat(board.style.left) + Number.parseFloat(board.style.width),
  ).toBeLessThanOrEqual(1000)
})

it('图层选择跟随画布点击，旧请求和旧坐标不改选区', () => {
  stubResizeObserver()
  const detail = detailFor()
  const view = showWorkspace(detail)
  const desktop = sandbox(screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页'))
  const mobile = sandbox(screen.getByTitle<HTMLIFrameElement>('画板内容：手机首页'))
  desktop.receive({ type: 'ready' })
  mobile.receive({ type: 'ready' })

  fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  const selector = ':scope > div:nth-of-type(1) > h1:nth-of-type(1)'
  const desktopLayer = {
    id: 'desktop:1',
    tag: 'h1',
    selector,
    sourceLoc: '1:1',
    label: '重复标题',
    width: 160,
    height: 35,
  }
  const mobileLayer = {
    id: 'mobile:1',
    tag: 'h1',
    selector,
    label: '重复标题',
    width: 140,
    height: 25,
  }
  const report = (layers: object[], version = 1) => ({
    type: 'inspect.layers.snapshot',
    version,
    layers,
    truncated: false,
  })
  expect(desktop.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'inspect.layers.watch', active: true }),
    '*',
  )
  mobile.receive(report([mobileLayer]))
  expect(within(inspector).queryByRole('button', { name: '重复标题' })).toBeNull()
  desktop.receive(report([desktopLayer]))
  const desktopChoice = within(inspector).getByRole('button', { name: '重复标题' })
  fireEvent.click(desktopChoice)
  expect(desktop.post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'highlight',
      layer: { id: 'desktop:1', version: 1 },
      element: { boardId: 'desktop', selector },
    }),
    '*',
  )
  expect(within(inspector).getByText('160 × 35 px')).toBeTruthy()
  fireEvent.keyDown(within(inspector).getByRole('tab', { name: '源码' }), { key: 'Enter' })
  expect(desktop.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'inspect.layers.watch', styleLayerId: desktopLayer.id }),
    '*',
  )
  desktop.receive({
    ...report([desktopLayer]),
    styles: {
      layerId: desktopLayer.id,
      declarations: [
        { property: 'color', value: 'maroon', source: 'style', inheritedFrom: 'main' },
      ],
      truncated: false,
    },
  })
  expect(within(inspector).getByText('color: maroon;')).toBeTruthy()
  const position = within(inspector).getByText('1:1')
  expect(position.closest('[dir]')?.getAttribute('dir')).toBe('ltr')
  expect(
    within(inspector).getByText('<h1', { selector: 'mark' }).closest('code')?.textContent,
  ).toContain('<h1>桌面预约</h1>')

  const element = { selector, rect: { x: 14, y: 7, width: 140, height: 25 } }
  mobile.receive({
    type: 'inspect.target',
    purpose: 'select',
    requestId: 'old',
    version: 1,
    element,
  })
  expect(desktopChoice.getAttribute('aria-pressed')).toBe('true')
  const hit = screen.getByRole('button', { name: '选择画板：手机首页' })
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 195, 422))
  fireEvent.click(hit, { detail: 1, clientX: 120, clientY: 80 })
  const request = mobile.post.mock.calls.find(
    ([message]) => message.type === 'inspect.at' && message.purpose === 'select',
  )?.[0]
  expect(request).toMatchObject({ version: 1, x: 40, y: 60 })
  mobile.receive({
    type: 'inspect.target',
    purpose: 'select',
    requestId: request.requestId,
    element,
    version: 1,
    layer: { id: mobileLayer.id, selector },
  })
  mobile.receive(report([mobileLayer]))
  expect(within(inspector).getByRole('button', { name: '手机首页', pressed: true })).toBeTruthy()
  expect(within(inspector).getByRole('button', { name: '重复标题', pressed: true })).toBeTruthy()
  expect(within(inspector).queryByText('color: maroon;')).toBeNull()
  const selectedBox = screen.getByTestId('overlay-select-box')
  const originalRect = selectedBox.getAttribute('style')
  mobile.receive({
    type: 'inspect.select',
    reason: 'sync',
    version: 1,
    layerId: 'mobile:old',
    layerSelector: selector,
    element: { selector, rect: { x: 50, y: 60, width: 20, height: 12 } },
  })
  expect(selectedBox.getAttribute('style')).toBe(originalRect)
  expect(within(inspector).getByText('无法定位此图层的源码。以下为画板源码。')).toBeTruthy()

  const displaced = ':scope > div:nth-of-type(2) > h1:nth-of-type(1)'
  mobile.receive(report([{ ...mobileLayer, selector: displaced }]))
  mobile.receive({ ...report([]), truncated: true })
  expect(screen.getByTestId('overlay-select-box').getAttribute('style')).toBe(originalRect)
  mobile.receive(report([{ ...mobileLayer, selector: displaced }]))

  fireEvent.keyDown(within(inspector).getByRole('tab', { name: '属性' }), { key: 'Enter' })
  expect(within(inspector).getByText('140 × 25 px')).toBeTruthy()
  fireEvent.click(within(inspector).getByRole('button', { name: '批注' }))
  const review = screen.getByRole('dialog', { name: '批注与评审' })
  expect(within(review).getByText('元素批注')).toBeTruthy()
  expect(within(review).getByText(displaced.slice(0, 36))).toBeTruthy()

  view.update(workspace(detailFor(2)))
  expect(within(review).getByText('版本批注')).toBeTruthy()
  expect(screen.queryByTestId('overlay-select-box')).toBeNull()
})

it('新版到达时将同板稳定块重绑到新节点，不捡起占用旧选择器的新对象', () => {
  stubResizeObserver()
  const view = showWorkspace()
  const mobile = sandbox(screen.getByTitle('画板内容：手机首页'))
  mobile.receive({ type: 'ready' })
  fireEvent.click(screen.getByRole('button', { name: '手机首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const inspector = screen.getByRole('dialog', { name: '检查器' })
  const original = {
    id: 'old-heading',
    blockId: 'mobile-details',
    tag: 'h1',
    label: '手机预约',
    selector: 'h1:first-child',
    width: 200,
    height: 34,
  }
  const report = (version: number, layers: object[]) =>
    mobile.receive({ type: 'inspect.layers.snapshot', version, layers, truncated: false })
  report(1, [original])
  fireEvent.click(within(inspector).getByRole('button', { name: '手机预约' }))
  act(() => useWorkspaceStore.getState().setInspectorTab(null))
  view.update(workspace(detailFor(2)))
  const fresh = { ...original, id: 'new-heading', selector: 'section > h1', label: '新版手机预约' }
  const replacement = { ...original, id: 'different', blockId: 'other', label: '占旧路径' }
  report(2, [replacement, fresh])
  expect(mobile.post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'highlight',
      layer: { id: 'new-heading', version: 2 },
      element: expect.objectContaining({
        boardId: 'mobile',
        selector: 'section > h1',
        blockId: 'mobile-details',
      }),
    }),
    '*',
  )
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  report(2, [replacement, fresh])
  const reopened = screen.getByRole('dialog', { name: '检查器' })
  expect(within(reopened).getByRole('button', { name: '新版手机预约', pressed: true })).toBeTruthy()
  expect(within(reopened).getByRole('button', { name: '占旧路径', pressed: false })).toBeTruthy()
})
