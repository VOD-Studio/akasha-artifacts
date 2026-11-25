// @vitest-environment jsdom
import { projectArtboard } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HubAccountButton } from '@/features/hub'
import { type ArtifactDetailResponse, artifactKeys } from '../src/entities/artifact'
import { createAppRouter } from '../src/routes/router'
import { setLocale } from '../src/shared/i18n'

const publicId = 'WorkBenchCanvasExample'
const projectId = 'workbench-project'
const title = '结账流程'
const createdAt = '2026-11-24T00:00:00.000Z'
const detail: ArtifactDetailResponse = {
  artifact: {
    publicId,
    projectId,
    slug: 'design/checkout',
    title,
    type: 'artboard',
    visibility: 'private',
    headVersion: 1,
    createdAt,
    updatedAt: createdAt,
  },
  version: {
    artifactId: publicId,
    version: 1,
    parentVersion: null,
    author: 'agent:cli',
    title,
    source: JSON.stringify({
      boards: [{ id: 'form', title: '确认订单', html: '<h1>确认订单</h1>' }],
    }),
    createdAt,
  },
  state: { artifactId: publicId, seq: 0, snapshot: {}, updatedAt: createdAt },
  rounds: [],
}

function openWorkspace(
  hub = false,
  canManage = true,
  detailFailure?: number,
  sourceFailure?: number,
  startAt = `/a/${publicId}${hub ? '?shared=1' : ''}`,
) {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub, sandboxOrigin: 'http://127.0.0.1:24331' })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
  const endpoint = `/api/v1/artifacts/${publicId}`
  const projection = projectArtboard(detail.version.source, 1)
  if (!projection) throw new Error('结账稿缺少画板投影')
  const { source: _source, ...summary } = detail.version
  const responses = new Map<string, unknown>([
    [endpoint, { ...detail, version: summary, canvas: projection.index }],
    [
      `${endpoint}/boards?version=1&boardId=form`,
      { artifactId: publicId, version: 1, board: projection.contents[0] },
    ],
    [`${endpoint}/versions`, { versions: [summary] }],
    [`${endpoint}/management`, { canManage }],
    [`${endpoint}/agent-session`, { availability: 'unbound' }],
    [`${endpoint}/feedback`, { items: [] }],
    ['/api/v1/auth/session', { user: { login: 'reviewer', member: true } }],
    ['/api/v1/daemon/status', { sandboxPort: 24331 }],
    ['/api/v1/favorites', { artifactIds: [] }],
    ['/api/v1/projects', { projects: [] }],
    ['/api/v1/artifacts', { artifacts: [detail.artifact] }],
  ])
  let failDetailWith = detailFailure
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { pathname, search } = new URL(String(input), window.location.origin)
    if (pathname === endpoint && search === '?version=1') {
      return sourceFailure ? new Response(null, { status: sourceFailure }) : Response.json(detail)
    }
    if (pathname === endpoint && failDetailWith) {
      const status = failDetailWith
      failDetailWith = undefined
      return new Response(null, { status })
    }
    if (pathname === `${endpoint}/boards`) {
      const board = responses.get(`${pathname}${search}`)
      return board ? Response.json(board) : new Response(null, { status: 404 })
    }
    if (responses.has(pathname)) return Response.json(responses.get(pathname))
    return new Response(null, { status: 404 })
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(artifactKeys.management(publicId), { canManage })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [startAt] }))
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return {
    router,
    denyAccess: () => {
      failDetailWith = 403
    },
  }
}

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const journeys = [
  ['zh-CN', '简体中文', '批注', '批注与评审', '关闭', '导出画板：确认订单', '导出范围'],
  [
    'en',
    'English',
    'Comments',
    'Comments and review',
    'Close',
    'Export artboard: 确认订单',
    'Export scope',
  ],
  [
    'de',
    'Deutsch',
    'Kommentare',
    'Kommentare und Review',
    'Schließen',
    'Zeichenfläche exportieren: 确认订单',
    'Exportumfang',
  ],
  [
    'ar',
    'العربية',
    'تعليقات',
    'التعليقات والمراجعة',
    'إغلاق',
    'تصدير لوحة الرسم: 确认订单',
    'نطاق التصدير',
  ],
] as const

it.each(journeys)(
  '%s 从作品库选板、审阅并导出同一份作者画稿',
  async (locale, name, comments, panelTitle, close, exportAction, scope) => {
    const { router } = openWorkspace(false, true, undefined, undefined, '/')
    const link = await screen.findByRole('link', { name: title })
    const language = screen.getByRole('button', { name: '界面语言' })
    fireEvent.keyDown(language, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name }))
    await waitFor(() => expect(document.documentElement.lang).toBe(locale))
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr')
    expect(screen.getByRole('link', { name: title })).toBe(link)
    fireEvent.click(link)
    const board = await screen.findByRole('button', { name: '确认订单' })
    fireEvent.click(board)
    const address = router.state.location.href
    const comment = within(screen.getByRole('banner')).getByRole('button', { name: comments })
    fireEvent.click(comment)
    const panel = await screen.findByRole('dialog', { name: panelTitle })
    expect(panel.getAttribute('aria-modal')).toBe('false')
    expect(panel.getAttribute('data-side')).toBe(locale === 'ar' ? 'left' : 'right')
    fireEvent.click(within(panel).getByRole('button', { name: close }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: panelTitle })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: exportAction }))
    const range = await screen.findByRole('combobox', { name: scope })
    await waitFor(() => expect(range.textContent).toContain('确认订单'))
    expect(router.state.location.href).toBe(address)
    expect(board.getAttribute('aria-pressed')).toBe('true')
  },
)

it('普通断线保留画布，实时服务拒绝订阅后重新查权并撤下缓存画面', async () => {
  const sockets: { onclose?: (event: CloseEvent) => void }[] = []
  vi.stubGlobal(
    'WebSocket',
    class {
      onclose?: (event: CloseEvent) => void
      constructor() {
        sockets.push(this)
      }
      close() {}
    },
  )
  const { denyAccess } = openWorkspace(true, false)
  const board = await screen.findByRole('button', { name: '确认订单' })
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  fireEvent(window, new Event('offline'))
  await screen.findByText('离线')
  expect(screen.getByRole('button', { name: '确认订单' })).toBe(board)
  online.mockReturnValue(true)
  fireEvent(window, new Event('online'))
  await waitFor(() => expect(screen.queryByText('离线')).toBeNull())
  denyAccess()
  await act(async () => sockets.at(-1)?.onclose?.(new CloseEvent('close', { code: 4403 })))
  await screen.findByText('没有查看权限')
  expect(screen.queryByRole('button', { name: '确认订单' })).toBeNull()
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
})

it('切换会话不重建画板，保留选区、倍率、草稿并归还焦点', async () => {
  openWorkspace()
  const frame = await screen.findByTitle('画板内容：确认订单')
  const board = screen.getByRole('button', { name: '确认订单' })
  fireEvent.click(board)
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const zoom = screen.getByLabelText('画布缩放比例').textContent
  const trigger = screen.getByRole('button', { name: 'Agent 对话' })
  fireEvent.click(trigger)

  const pane = screen.getByRole('complementary', { name: 'Agent 对话' })
  expect(document.activeElement).toBe(within(pane).getByRole('heading'))
  await within(pane).findByText('未绑定会话')
  fireEvent.change(within(pane).getByRole('textbox', { name: '消息' }), {
    target: { value: '调整确认按钮' },
  })
  fireEvent.click(within(pane).getByRole('button', { name: '返回画布' }))
  expect(screen.queryByRole('complementary', { name: 'Agent 对话' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(screen.getByTitle('画板内容：确认订单')).toBe(frame)
  expect(board.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoom)

  fireEvent.click(trigger)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '消息' }).value).toBe(
    '调整确认按钮',
  )
})

it('Hub 中所有者会话可从顶栏管理分享，普通读者不显示该入口', async () => {
  openWorkspace(true, false)
  await screen.findByTitle('画板内容：确认订单')
  expect(screen.queryByRole('button', { name: 'Agent 对话' })).toBeNull()
  expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
  cleanup()

  const { router } = openWorkspace(true, true, undefined, undefined, '/')
  const openInHub = await screen.findByRole('link', { name: `在 Hub 打开：${title}` })
  expect(screen.getByRole('link', { name: title }).getAttribute('href')).toBe(`/a/${publicId}`)
  fireEvent.click(openInHub)
  await waitFor(() => expect(router.state.location.href).toBe(`/a/${publicId}?shared=1`))
  fireEvent.click(await screen.findByRole('button', { name: '分享' }))
  expect(screen.getByRole('dialog', { name: '管理作品分享' })).toBeTruthy()
})

it('首次读取作品失败时可重试，成功后打开同一作品', async () => {
  openWorkspace(false, true, 503)
  expect(await screen.findByText('无法打开作品')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：确认订单')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByTitle('画板内容：确认订单')).toBeTruthy()
  expect(screen.queryByText('无法打开作品')).toBeNull()
})

it('定版正文暂不可读时，设置画板保留填过的尺寸', async () => {
  openWorkspace(false, true, undefined, 503)
  await screen.findByTitle('画板内容：确认订单')
  fireEvent.click(screen.getByRole('button', { name: '设置画板：确认订单' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '宽度' }), { target: { value: '900' } })
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await screen.findByText(/HTTP 503/)
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '宽度' }).value).toBe('900')
})

it('Hub 登录与退出使用工作台同源，不把会话 Cookie 发往作品 API 地址', async () => {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true, apiBaseUrl: 'https://api.example.test' })
  const request = vi.spyOn(window, 'fetch').mockImplementation(async (url) => {
    if (url === '/api/v1/auth/session')
      return Response.json({ user: { login: 'reviewer', member: true } })
    return new Response(null, { status: 503 })
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <HubAccountButton />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '退出 @reviewer' }))
  expect(request).toHaveBeenCalledWith(
    '/api/v1/auth/session',
    expect.objectContaining({ credentials: 'same-origin' }),
  )
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })
})
