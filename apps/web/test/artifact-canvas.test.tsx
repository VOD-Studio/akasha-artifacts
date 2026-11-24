// @vitest-environment jsdom
import { type Artifact, type Feedback, PROTOCOL_VERSION, type Version } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArtifactDetailResponse } from '../src/entities/artifact'
import { useSelectionStore } from '../src/entities/selection'
import { useWorkspaceStore } from '../src/entities/workspace'
import { createAppRouter } from '../src/routes/router'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { TopBar } from '../src/widgets/TopBar'

const artifact: Artifact = {
  publicId: 'CanvasExamplePublicId1',
  slug: 'artboard/reservation',
  projectId: 'project-canvas',
  title: '茶席预约',
  type: 'artboard',
  visibility: 'private',
  headVersion: 1,
  createdAt: '2026-11-22T09:00:00.000Z',
  updatedAt: '2026-11-22T09:00:00.000Z',
}

const design = {
  pages: [
    { id: 'reserve', title: '预约流程' },
    { id: 'status', title: '状态' },
  ],
  boards: [
    {
      id: 'desktop',
      title: '宽屏首页',
      pageId: 'reserve',
      viewport: { width: 1440, height: 900 },
      html: '<h1>桌面预约</h1>',
    },
    {
      id: 'mobile',
      title: '手机首页',
      pageId: 'reserve',
      viewport: { width: 390, height: 844 },
      html: '<h1 data-ak-block="mobile-details">手机预约</h1>',
    },
    { id: 'success', title: '预约完成', pageId: 'status', description: '已确认时段' },
  ],
}

function detailFor(versionNumber = 1, source = JSON.stringify(design)): ArtifactDetailResponse {
  const version: Version = {
    artifactId: artifact.publicId,
    version: versionNumber,
    parentVersion: versionNumber === 1 ? null : versionNumber - 1,
    author: 'agent:cli',
    title: artifact.title,
    source,
    createdAt: artifact.createdAt,
  }
  return {
    artifact: { ...artifact, headVersion: versionNumber },
    version,
    state: {
      artifactId: artifact.publicId,
      snapshot: {},
      seq: 0,
      updatedAt: version.createdAt,
    },
    rounds: [],
  }
}

function workspace(detail = detailFor(), feedbacks?: readonly Feedback[]) {
  return (
    <ArtifactWorkspace
      detail={detail}
      versions={[detail.version]}
      feedbacks={feedbacks}
      sandboxOrigin="http://127.0.0.1:24331"
    />
  )
}

function showWorkspace(detail = detailFor(), feedbacks?: readonly Feedback[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (view: React.ReactNode) => (
    <QueryClientProvider client={client}>{view}</QueryClientProvider>
  )
  const view = render(wrap(workspace(detail, feedbacks)))
  return { ...view, update: (element: React.ReactNode) => view.rerender(wrap(element)) }
}

function sandbox(frame: HTMLIFrameElement) {
  const win = frame.contentWindow
  if (!win) throw new Error('测试画板未建立独立窗口')
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')
  return {
    nonce,
    post: vi.spyOn(win, 'postMessage').mockImplementation(() => {}),
    receive(data: Record<string, unknown>) {
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'null',
          source: win,
          data: { ...data, v: PROTOCOL_VERSION, nonce },
        }),
      )
    },
  }
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(2400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2100)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useSelectionStore.getState().clearSelection(artifact.publicId)
  useWorkspaceStore.setState({ inspectorTab: null })
  sessionStorage.clear()
})

it('展开的画板报错时，仍用作品原始链接向 Agent 投递', async () => {
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}))
  const base = detailFor(1, '<h1>预约首页</h1>')
  showWorkspace({ ...base, artifact: { ...base.artifact, type: 'html' } })
  fireEvent.click(screen.getByRole('button', { name: '展开画板：茶席预约' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  const frame = within(focus).getByTitle<HTMLIFrameElement>('画板内容：茶席预约')
  const sandboxFrame = sandbox(frame)
  sandboxFrame.receive({ type: 'ready' })
  sandboxFrame.receive({ type: 'error', phase: 'runtime', message: '焦点画板报错' })
  fireEvent.click(within(focus).getByRole('button', { name: '交给 Agent 修复' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/artifacts/${artifact.publicId}/feedback`),
      expect.objectContaining({ method: 'POST' }),
    ),
  )
})

it('在同一画布页面比较独立视口的宽屏和手机画板', () => {
  const legacyPin: Feedback = {
    id: 'mobile-pin',
    artifactId: artifact.publicId,
    version: 1,
    roundId: null,
    groupId: null,
    kind: 'comment',
    element: { blockId: 'mobile-details', rect: { x: 10, y: 12, width: 90, height: 30 } },
    body: '确认手机字号',
    author: 'human:local',
    draft: false,
    status: 'pending',
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  }
  showWorkspace(detailFor(), [legacyPin])
  const desktop = screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页')
  const mobile = screen.getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect([desktop.width, desktop.height]).toEqual(['1440', '900'])
  expect([mobile.width, mobile.height]).toEqual(['390', '844'])
  expect(desktop.contentWindow).not.toBe(mobile.contentWindow)
  expect(screen.queryByTitle('画板内容：预约完成')).toBeNull()

  const desktopSandbox = sandbox(desktop)
  const mobileSandbox = sandbox(mobile)
  expect(desktopSandbox.nonce).not.toBe(mobileSandbox.nonce)
  desktopSandbox.receive({ type: 'ready' })
  mobileSandbox.receive({ type: 'ready' })
  expect(desktopSandbox.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'render', boardId: 'desktop', source: '<h1>桌面预约</h1>' }),
    '*',
  )
  expect(mobileSandbox.post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'render',
      boardId: 'mobile',
      source: '<h1 data-ak-block="mobile-details">手机预约</h1>',
    }),
    '*',
  )
  expect(mobile.parentElement?.contains(screen.getByTitle('确认手机字号'))).toBe(true)
  expect(desktopSandbox.post).not.toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'pins.track',
      pins: expect.arrayContaining([expect.objectContaining({ id: legacyPin.id })]),
    }),
    '*',
  )

  mobileSandbox.receive({ type: 'error', phase: 'runtime', message: '手机画板渲染失败' })
  expect(mobile.parentElement?.contains(screen.getByText('手机画板渲染失败'))).toBe(true)
  expect(desktop.parentElement?.querySelector('[role="alert"]')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '展开画板：手机首页' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  expect(within(focus).queryByTitle('确认手机字号')).toBeNull()
  fireEvent.click(within(focus).getByRole('button', { name: '返回总览' }))
  expect(screen.getByTitle('确认手机字号')).toBeTruthy()
})

it('跨页查找、热更新和刷新都保留仍在的选板与倍率', () => {
  const opened = showWorkspace()
  const title = screen.getByRole('button', { name: '手机首页' })
  fireEvent.click(title)
  expect(screen.getByTitle('画板内容：手机首页').hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(title, { key: 'Escape' })
  expect(title.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '手机首页' }))
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const zoomed = screen.getByLabelText('画布缩放比例').textContent

  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.change(screen.getByLabelText('搜索页面或画板'), { target: { value: '预约完成' } })
  fireEvent.click(screen.getByRole('button', { name: '预约完成' }))
  expect(screen.getByTitle('画板内容：预约完成')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '预约流程' }))
  expect(screen.getByRole('button', { name: '手机首页' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoomed)

  const next = detailFor(
    2,
    JSON.stringify({
      ...design,
      boards: design.boards.map((board) =>
        board.id === 'mobile' ? { ...board, title: '手机首页新版' } : board,
      ),
    }),
  )
  const originalFrame = screen.getByTitle('画板内容：手机首页')
  opened.update(workspace(next))
  expect(screen.getByTitle('画板内容：手机首页新版')).toBe(originalFrame)
  expect(screen.getByRole('button', { name: '手机首页新版' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoomed)

  opened.unmount()
  showWorkspace(next)
  expect(screen.getByRole('button', { name: '手机首页新版' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoomed)
})

it('展开画板按固有视口渲染，退出恢复总览的倍率、选板和键盘焦点', () => {
  showWorkspace()
  const canvas = screen.getByRole('region', { name: '画布' })
  const title = within(canvas).getByRole('button', { name: '手机首页' })
  fireEvent.click(title)
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const overviewZoom = screen.getByLabelText('画布缩放比例').textContent
  const launch = within(canvas).getByRole('button', { name: '展开画板：手机首页' })
  fireEvent.click(launch)

  const focus = screen.getByRole('region', { name: '画板查看' })
  expect(screen.queryByRole('region', { name: '画布' })).toBeNull()
  const frame = within(focus).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect([frame.width, frame.height, frame.getAttribute('sandbox')]).toEqual([
    '390',
    '844',
    'allow-scripts',
  ])
  expect(frame.hasAttribute('inert')).toBe(true)
  fireEvent.click(within(focus).getByRole('button', { name: '填充宽度' }))
  expect(within(focus).getByRole('button', { name: '填充宽度' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  fireEvent.click(within(focus).getByRole('button', { name: '实际大小' }))
  expect(within(focus).getByLabelText('画板缩放比例').textContent).toBe('100%')

  fireEvent.keyDown(within(focus).getByRole('button', { name: '返回总览' }), { key: 'Escape' })
  expect(screen.queryByRole('region', { name: '画板查看' })).toBeNull()
  expect(title.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(overviewZoom)
  expect(document.activeElement).toBe(launch)
})

it('显式播放原型才能交互和跨页，退出后返回原来的画板查看状态', () => {
  const source = JSON.stringify({
    ...design,
    showFlows: false,
    flows: [{ from: 'mobile', to: 'success', label: '确认预约' }],
    boards: design.boards.map((board) =>
      board.id === 'mobile'
        ? { ...board, html: '<button data-ak-next="success">确认预约</button>' }
        : board,
    ),
  })
  showWorkspace(detailFor(1, source))
  const overview = screen.getByRole('region', { name: '画布' })
  const mobile = within(overview).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  const mobileSandbox = sandbox(mobile)
  mobileSandbox.receive({ type: 'ready' })
  mobileSandbox.receive({ type: 'rendered', version: 1, playable: false })
  expect(within(overview).queryByRole('button', { name: '播放原型：手机首页' })).toBeNull()
  mobileSandbox.receive({ type: 'prototype.availability', version: 2, playable: true })
  expect(within(overview).queryByRole('button', { name: '播放原型：手机首页' })).toBeNull()
  mobileSandbox.receive({ type: 'prototype.availability', version: 1, playable: true })
  expect(mobile.hasAttribute('inert')).toBe(true)
  expect(within(overview).queryByRole('button', { name: '播放原型：宽屏首页' })).toBeNull()

  fireEvent.click(within(overview).getByRole('button', { name: '展开画板：手机首页' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  fireEvent.click(within(focus).getByRole('button', { name: '实际大小' }))
  const play = within(focus).getByRole('button', { name: '播放原型：手机首页' })
  fireEvent.click(play)
  const playback = screen.getByRole('region', { name: '交互预览' })
  const running = within(playback).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect(running.hasAttribute('inert')).toBe(false)
  expect(running.getAttribute('sandbox')).toBe('allow-scripts')
  expect(running.contentWindow).not.toBe(mobile.contentWindow)

  const player = sandbox(running)
  player.receive({ type: 'ready' })
  expect(player.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'render', playback: true, version: 1, boardId: 'mobile' }),
    '*',
  )
  player.receive({ type: 'prototype.navigate', version: 1, target: 'desktop' })
  player.receive({ type: 'prototype.navigate', version: 2, target: 'success' })
  expect(within(playback).queryByTitle('画板内容：预约完成')).toBeNull()
  player.receive({ type: 'prototype.navigate', version: 1, target: 'success' })
  const nextPlayback = screen.getByRole('region', { name: '交互预览' })
  const complete = within(nextPlayback).getByTitle<HTMLIFrameElement>('画板内容：预约完成')
  expect(complete.contentWindow).not.toBe(running.contentWindow)
  const completeSandbox = sandbox(complete)
  completeSandbox.receive({ type: 'ready' })
  completeSandbox.receive({ type: 'prototype.exit', version: 1 })
  expect(screen.queryByRole('region', { name: '交互预览' })).toBeNull()
  expect(screen.getByRole('region', { name: '画板查看' })).toBe(focus)
  expect(within(focus).getByLabelText('画板缩放比例').textContent).toBe('100%')
  expect(document.activeElement).toBe(play)
})

function stubResizeObserver() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
}

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
  fireEvent.keyDown(within(inspector).getByRole('tab', { name: '源码' }), { key: 'Enter' })
  expect(within(inspector).getByText(/"description":"已确认时段"/)).toBeTruthy()
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

it('图层双向定位只在该画板与版本生效，悬停和旧坐标不改选区', () => {
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
  expect(within(inspector).getByText('源码位置 1:1')).toBeTruthy()
  expect(
    within(inspector).getByText('<h1', { selector: 'mark' }).closest('code')?.textContent,
  ).toContain('<h1>桌面预约</h1>')

  fireEvent.click(within(inspector).getByRole('button', { name: '指认元素' }))
  const element = { selector, rect: { x: 14, y: 7, width: 140, height: 25 } }
  mobile.receive({ type: 'inspect.hover', element })
  expect(desktopChoice.getAttribute('aria-pressed')).toBe('true')
  // 只允许活动画板接收沙盒输入；跨板指认先选中另一块画板。
  fireEvent.click(screen.getByRole('button', { name: '选择画板：手机首页' }))
  mobile.receive({
    type: 'inspect.select',
    reason: 'click',
    element,
    version: 1,
    layerId: mobileLayer.id,
    layerSelector: selector,
  })
  mobile.receive(report([mobileLayer]))
  expect(within(inspector).getByRole('button', { name: '手机首页', pressed: true })).toBeTruthy()
  expect(within(inspector).getByRole('button', { name: '重复标题', pressed: true })).toBeTruthy()
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

it('旧制品没有显式 ID 时，重排后仍选中原标题的画板', () => {
  const home = { title: '旧的预约页' }
  const other = { title: '旧的结果页' }
  const mobile = { title: '旧的手机稿', viewport: { width: 390, height: 844 } }
  const desktop = { title: '旧的桌面稿' }
  const old = detailFor(1, JSON.stringify({ pages: [home, other], boards: [desktop, mobile] }))
  const changed = detailFor(2, JSON.stringify({ pages: [other, home], boards: [mobile, desktop] }))
  const view = showWorkspace(old)
  fireEvent.click(screen.getByRole('button', { name: '旧的手机稿' }))
  view.update(workspace(changed))
  expect(screen.getByRole('button', { name: '旧的手机稿' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(screen.getByRole('button', { name: '旧的桌面稿' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  expect(screen.getByRole('button', { name: '旧的预约页' }).getAttribute('aria-current')).toBe(
    'page',
  )
})

it('固定版本定位到指定页面，复制的定位链接不携带分享授权', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const fixed = detailFor()
  const head = detailFor(
    2,
    JSON.stringify({
      ...design,
      boards: design.boards.map((board) =>
        board.id === 'success' ? { ...board, title: '新版确认页' } : board,
      ),
    }),
  )
  const endpoint = `/api/v1/artifacts/${artifact.publicId}`
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === endpoint) {
      return Response.json(
        url.searchParams.get('version') === '1' ? { ...fixed, artifact: head.artifact } : head,
      )
    }
    if (url.pathname === `${endpoint}/versions`) {
      return Response.json({ versions: [fixed.version, head.version] })
    }
    if (url.pathname === `${endpoint}/feedback`) return Response.json({ items: [] })
    if (url.pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
    if (url.pathname === '/api/v1/projects') return Response.json({ projects: [] })
    if (url.pathname === '/api/v1/artifacts') return Response.json({ artifacts: [] })
    if (url.pathname === '/api/v1/favorites') return Response.json({ artifactIds: [] })
    return Response.json({ selection: null })
  })
  const router = createAppRouter(
    createMemoryHistory({
      initialEntries: [`/a/${artifact.publicId}/v/1?share=test-token#page=status&board=success`],
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const writeText = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  try {
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    expect(await screen.findByTitle('画板内容：预约完成')).toBeTruthy()
    expect(screen.queryByTitle('画板内容：新版确认页')).toBeNull()
    expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
    expect(screen.queryByRole('button', { name: '新建页面' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '复制页面链接' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/a/${artifact.publicId}/v/1#page=status`,
      ),
    )

    await router.navigate({
      to: '/a/$publicId/v/$version',
      params: { publicId: artifact.publicId, version: '1' },
      search: true,
      resetScroll: false,
      hash: 'page=status&board=missing',
    })
    expect((await screen.findByRole('alert')).textContent).toContain('链接中的画板不存在')
    expect(screen.queryByTitle('画板内容：预约完成')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }))
    expect(await screen.findByTitle('画板内容：预约完成')).toBeTruthy()
    expect(router.state.location.search).toMatchObject({ share: 'test-token' })
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

it('手动重读遇到暂时故障仍保留画布，失去读取权限时撤下已有内容', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  const detail = detailFor()
  const endpoint = `/api/v1/artifacts/${artifact.publicId}`
  let status = 200
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { pathname } = new URL(String(input), window.location.origin)
    if (pathname === endpoint)
      return status === 200 ? Response.json(detail) : new Response(null, { status })
    if (pathname === `${endpoint}/versions`) return Response.json({ versions: [detail.version] })
    if (pathname === `${endpoint}/management`) return Response.json({ canManage: true })
    if (pathname === `${endpoint}/feedback`) return Response.json({ items: [], threads: {} })
    if (pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
    if (pathname === '/api/v1/projects') return Response.json({ projects: [] })
    if (pathname === '/api/v1/artifacts') return Response.json({ artifacts: [artifact] })
    return Response.json({ selection: null })
  })
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/a/${artifact.publicId}`] }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const frame = await screen.findByTitle('画板内容：宽屏首页')
  const reload = () => {
    fireEvent.keyDown(screen.getByRole('button', { name: '作品菜单' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: '重新加载' }))
  }
  status = 503
  reload()
  await screen.findAllByText('请求失败（HTTP 503）')
  expect(screen.getByTitle('画板内容：宽屏首页')).toBe(frame)
  status = 403
  reload()
  await screen.findByText('没有查看权限')
  expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()
})

function showEditableWorkspace(initial: ArtifactDetailResponse, address?: string) {
  const view = showWorkspace(initial)
  const editable = (detail: ArtifactDetailResponse) => (
    <ArtifactWorkspace
      detail={detail}
      versions={[detail.version]}
      sandboxOrigin="http://127.0.0.1:24331"
      address={address}
      onVersionSaved={(version) =>
        view.update(editable(detailFor(version.version, version.source)))
      }
    />
  )
  let submittedVersion: number | undefined
  let current = initial
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    if (input === '/api/v1/artifacts' && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body))
      submittedVersion = payload.baseVersion
      current = detailFor(current.version.version + 1, payload.source)
      return Response.json(current)
    }
    return Response.json({ selection: null })
  })
  view.update(editable(initial))
  return {
    get current() {
      return current
    },
    get submittedVersion() {
      return submittedVersion
    },
    receiveAgentSource(source: string) {
      current = detailFor(current.version.version + 1, source)
      view.update(editable(current))
    },
  }
}

it('新建页面保存为头版本，空页不继承未分组画板', async () => {
  const editor = showEditableWorkspace(
    detailFor(
      1,
      JSON.stringify({ boards: [{ id: 'cover', title: '旧画板', html: '<h1>旧内容</h1>' }] }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '新建页面' }))
  fireEvent.change(screen.getByRole('textbox', { name: '页面名称' }), { target: { value: '备忘' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))

  expect(await screen.findByText('此页面没有画板')).toBeTruthy()
  expect(editor.submittedVersion).toBe(1)
  expect(screen.queryByTitle('画板内容：旧画板')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '旧画板' }))
  expect(screen.getByTitle('画板内容：旧画板')).toBeTruthy()
})

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

it('沿用旧页定位链接完成重命名，确认删除时只移除该页直属画板', async () => {
  const initial = detailFor(
    1,
    JSON.stringify({
      pages: [{ title: '旧预约' }, { id: 'keep', title: '保留页' }],
      boards: [
        { title: '要移除的画板', pageId: 'page-1' },
        { title: '要保留的画板', pageId: 'keep' },
        { id: 'shared', title: '共享画板' },
      ],
      flows: [{ from: 'board-1', to: 'board-2' }],
    }),
  )
  const address = new URLSearchParams({ page: 'legacy-page:旧预约' }).toString()
  const editor = showEditableWorkspace(initial, address)
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '重命名页面' }))
  fireEvent.change(screen.getByRole('textbox', { name: '页面名称' }), {
    target: { value: '新预约' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '页面与画板' }).textContent).toBe('新预约'),
  )
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '删除页面' }))
  expect(screen.getByText(/1 张直属画板/)).toBeTruthy()
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(await screen.findByTitle('画板内容：要保留的画板')).toBeTruthy()
  expect(screen.getByTitle('画板内容：共享画板')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：要移除的画板')).toBeNull()
  expect(JSON.parse(editor.current.version.source)).toMatchObject({ flows: [] })
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
  fireEvent.click(layer('应用'))
  expect(await screen.findByText('作品已更新，未覆盖新版本。')).toBeTruthy()
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[1].width).toBe(92)
})

it('拖出矩形只预览，松开按画板固有坐标保存并可撤销重做', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
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
  const request = frame.post.mock.calls.find(([message]) => message.type === 'inspect.text.at')?.[0]
  expect(request).toMatchObject({ version: 1, x: 70, y: 70 })
  frame.receive({
    type: 'inspect.text.target',
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

it('双轴滚动平移画布，只有带缩放修饰键的滚轮才改变倍率', () => {
  showWorkspace()
  const viewport = screen.getByRole('region', { name: '画布' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  const board = title.closest<HTMLElement>('.artifact-canvas-board')
  if (!board) throw new Error('缺少画板')
  fireEvent.click(title)
  const zoom = screen.getByLabelText('画布缩放比例')
  const initial = zoom.textContent
  const left = Number.parseFloat(board.style.left)
  const top = Number.parseFloat(board.style.top)
  fireEvent.wheel(viewport, { deltaX: 70, deltaY: 45 })
  expect(Number.parseFloat(board.style.left)).toBe(left - 70)
  expect(Number.parseFloat(board.style.top)).toBe(top - 45)
  expect(zoom.textContent).toBe(initial)
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 700, clientY: 400 })
  expect(Number.parseFloat(zoom.textContent ?? '')).toBeGreaterThan(
    Number.parseFloat(initial ?? ''),
  )
  expect(title.getAttribute('aria-pressed')).toBe('true')
})
