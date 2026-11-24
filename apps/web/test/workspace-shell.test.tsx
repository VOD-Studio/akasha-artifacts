// @vitest-environment jsdom
import { projectArtboard } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HubAccountButton } from '@/features/hub'
import { type ArtifactDetailResponse, artifactKeys } from '../src/entities/artifact'
import { createAppRouter } from '../src/routes/router'

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

function openWorkspace(hub = false, canManage = true, detailFailure?: number) {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub, sandboxOrigin: 'http://127.0.0.1:24331' })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
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
      `${endpoint}/boards/form`,
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
    const { pathname } = new URL(String(input), window.location.origin)
    if (pathname === endpoint && failDetailWith) {
      const status = failDetailWith
      failDetailWith = undefined
      return new Response(null, { status })
    }
    if (responses.has(pathname)) return Response.json(responses.get(pathname))
    return new Response(null, { status: 404 })
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(artifactKeys.management(publicId), { canManage })
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/a/${publicId}${hub ? '?shared=1' : ''}`] }),
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

it('Hub 中管理者可从顶栏分享，普通读者不显示该入口', async () => {
  openWorkspace(true, false)
  await screen.findByTitle('画板内容：确认订单')
  expect(screen.queryByRole('button', { name: 'Agent 对话' })).toBeNull()
  expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
  cleanup()

  openWorkspace(true)
  fireEvent.click(await screen.findByRole('button', { name: '分享' }))
  expect(screen.getByRole('dialog', { name: '创建分享链接' })).toBeTruthy()
})

it('首次读取作品失败时可重试，成功后打开同一作品', async () => {
  openWorkspace(false, true, 503)
  expect(await screen.findByText('无法打开作品')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：确认订单')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByTitle('画板内容：确认订单')).toBeTruthy()
  expect(screen.queryByText('无法打开作品')).toBeNull()
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
