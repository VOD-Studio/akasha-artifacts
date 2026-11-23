// @vitest-environment jsdom
import { type Artifact, type Feedback, PROTOCOL_VERSION, type Version } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppRouter } from '../src/routes/router'
import type { ArtifactDetailResponse } from '../src/shared/api/client'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace/ArtifactWorkspace'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
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
  const desktop = screen.getByTitle<HTMLIFrameElement>('宽屏首页 隔离沙盒')
  const mobile = screen.getByTitle<HTMLIFrameElement>('手机首页 隔离沙盒')
  expect([desktop.width, desktop.height]).toEqual(['1440', '900'])
  expect([mobile.width, mobile.height]).toEqual(['390', '844'])
  expect(desktop.contentWindow).not.toBe(mobile.contentWindow)
  expect(screen.queryByTitle('预约完成 隔离沙盒')).toBeNull()

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
})

it('跨页查找、热更新和刷新都保留仍在的选板与倍率', () => {
  const opened = showWorkspace()
  const title = screen.getByRole('button', { name: '手机首页' })
  fireEvent.click(title)
  expect(screen.getByTitle('手机首页 隔离沙盒').hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(title, { key: 'Escape' })
  expect(title.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '手机首页' }))
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const zoomed = screen.getByLabelText('画布缩放比例').textContent

  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.change(screen.getByLabelText('搜索页面或画板'), { target: { value: '预约完成' } })
  fireEvent.click(screen.getByRole('button', { name: '预约完成' }))
  expect(screen.getByTitle('预约完成 隔离沙盒')).toBeTruthy()
  expect(screen.queryByTitle('宽屏首页 隔离沙盒')).toBeNull()

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
  const originalFrame = screen.getByTitle('手机首页 隔离沙盒')
  opened.update(workspace(next))
  expect(screen.getByTitle('手机首页新版 隔离沙盒')).toBe(originalFrame)
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
    if (url.pathname === '/api/v1/feedback')
      return Response.json({ items: [], rounds: [], cursor: '' })
    if (url.pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
    if (url.pathname === '/api/v1/projects') return Response.json({ projects: [] })
    if (url.pathname === '/api/v1/artifacts') return Response.json({ artifacts: [] })
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
    expect(await screen.findByTitle('预约完成 隔离沙盒')).toBeTruthy()
    expect(screen.queryByTitle('新版确认页 隔离沙盒')).toBeNull()
    expect(screen.queryByTitle('宽屏首页 隔离沙盒')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
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
    expect((await screen.findByRole('alert')).textContent).toContain('链接指定的画板不存在或已移除')
    expect(screen.queryByTitle('预约完成 隔离沙盒')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }))
    expect(await screen.findByTitle('预约完成 隔离沙盒')).toBeTruthy()
    expect(router.state.location.search).toMatchObject({ share: 'test-token' })
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

it('新建页面保存为头版本，空页不继承旧制品的未分组画板', async () => {
  const initial = detailFor(
    1,
    JSON.stringify({ boards: [{ id: 'cover', title: '旧画板', html: '<h1>旧内容</h1>' }] }),
  )
  const view = showWorkspace(initial)
  const editable = (detail: ArtifactDetailResponse) => (
    <ArtifactWorkspace
      detail={detail}
      versions={[detail.version]}
      sandboxOrigin="http://127.0.0.1:24331"
      onVersionSaved={(version) =>
        view.update(editable(detailFor(version.version, version.source)))
      }
    />
  )
  let submittedVersion: number | undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    if (input === '/api/v1/artifacts' && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body))
      submittedVersion = payload.baseVersion
      return Response.json(detailFor(2, payload.source))
    }
    return Response.json({ selection: null })
  })
  view.update(editable(initial))
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '新建页面' }))
  fireEvent.change(screen.getByRole('textbox', { name: '页面名称' }), { target: { value: '备忘' } })
  fireEvent.click(screen.getByRole('button', { name: '保存页面' }))

  expect(await screen.findByText('此页面没有画板')).toBeTruthy()
  expect(submittedVersion).toBe(1)
  expect(screen.queryByTitle('旧画板 隔离沙盒')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '旧画板' }))
  expect(screen.getByTitle('旧画板 隔离沙盒')).toBeTruthy()
})
