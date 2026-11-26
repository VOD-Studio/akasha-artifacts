// @vitest-environment jsdom
import { type Feedback, PROTOCOL_VERSION } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact'
import { applyRealtimeEventToCache } from '../src/features/live-sync'
import { createAppRouter } from '../src/routes/router'
import { setLocale } from '../src/shared/i18n'
import {
  artifact,
  detailFor,
  sandbox,
  setupCanvasTest,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()
afterEach(() => setLocale('zh-CN'))

const invitation = '/invite/inv-123'
const acceptUrl = '/api/v1/invitations/inv-123/accept'
const sessionUrl = '/api/v1/auth/session'
const endpoint = `/api/v1/artifacts/${artifact.publicId}`
const detail = detailFor(
  1,
  JSON.stringify({
    boards: [
      {
        id: 'cover',
        title: 'Cover',
        html: '<button>Next</button>',
        viewport: { width: 320, height: 200 },
        presentation: { interactive: true },
      },
    ],
  }),
)
const signedIn = {
  user: { login: 'sam', userId: '123', member: false, admin: false, kind: 'session' },
}
const internal: Feedback = {
  id: 'internal',
  artifactId: artifact.publicId,
  version: 1,
  kind: 'comment',
  roundId: null,
  groupId: null,
  element: null,
  audience: 'agent',
  body: 'Author notes',
  author: 'sam',
  draft: false,
  status: 'pending',
  createdAt: artifact.createdAt,
  updatedAt: artifact.updatedAt,
}

type Access = 'view' | 'comment' | 'edit' | 'owner-only' | 'revoked'

function openHub(
  startAt: string,
  options: { role?: Access; signedOut?: boolean; acceptStatus?: number; cached?: boolean } = {},
) {
  stubResizeObserver()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true, sandboxOrigin: 'http://127.0.0.1:24331' })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal('WebSocket', undefined)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let role: Access = options.role ?? 'view'
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { pathname, searchParams } = new URL(String(input), window.location.origin)
    if (pathname === sessionUrl) return Response.json(options.signedOut ? { user: null } : signedIn)
    if (pathname === acceptUrl)
      return options.acceptStatus
        ? new Response(null, { status: options.acceptStatus })
        : Response.json({ artifactId: artifact.publicId })
    if (pathname === endpoint) {
      if (role === 'revoked') return new Response(null, { status: 404 })
      const canvas =
        searchParams.get('view') === 'canvas'
          ? {
              hubCanEditCanvas:
                !searchParams.has('version') && (role === 'edit' || role === 'owner-only'),
            }
          : {}
      if (role === 'owner-only') return Response.json({ ...detail, ...canvas, hubRestricted: true })
      return Response.json({
        ...detail,
        ...canvas,
        access: { role, expiresAt: new Date(Date.now() + 60_000).toISOString() },
      })
    }
    if (pathname === `${endpoint}/versions`) return Response.json({ versions: [detail.version] })
    if (pathname === `${endpoint}/feedback`)
      return Response.json({ items: role === 'owner-only' ? [internal] : [], threads: {} })
    if (pathname === `${endpoint}/management`)
      return Response.json({ canManage: role === 'owner-only' })
    if (pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
    if (pathname === '/api/v1/projects') return Response.json({ projects: [] })
    if (pathname === '/api/v1/artifacts') return Response.json({ artifacts: [] })
    if (pathname === '/api/v1/favorites') return Response.json({ artifactIds: [] })
    return new Response(null, { status: 404 })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (options.cached) client.setQueryData(artifactKeys.canvas(artifact.publicId), detail)
  const router = createAppRouter(createMemoryHistory({ initialEntries: [startAt] }))
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const changeAccess = (next: Access) => {
    role = next
    act(() =>
      applyRealtimeEventToCache(client, {
        type: 'artifact.metadata',
        v: PROTOCOL_VERSION,
        seq: 1,
        timestamp: new Date().toISOString(),
        artifactId: artifact.publicId,
      }),
    )
  }
  return { request, router, changeAccess }
}

it('未登录邀请页不读作品；OAuth 返回值只含当前邀请，不转发查询串中的 next', async () => {
  setLocale('en')
  const { request } = openHub(`${invitation}?next=https://elsewhere.example/`, { signedOut: true })
  const signIn = await screen.findByRole('link', { name: 'Sign in with GitHub' })
  expect(signIn.getAttribute('href')).toBe(`/auth/login?next=${encodeURIComponent(invitation)}`)
  expect(request.mock.calls.map(([url]) => url)).toEqual([sessionUrl])
})

it.each([401, 404])('服务端拒绝接受（%i）时留在邀请页，不加载作品或向作者投递', async (status) => {
  const { request, router } = openHub(invitation, { acceptStatus: status })
  fireEvent.click(await screen.findByRole('button', { name: '以 @sam 接受邀请' }))
  if (status === 401)
    expect(await screen.findByRole('link', { name: '使用 GitHub 登录' })).toBeTruthy()
  else expect(await screen.findByText('邀请不可用')).toBeTruthy()
  expect(router.state.location.pathname).toBe(invitation)
  expect(request.mock.calls.map(([url]) => url)).toEqual([sessionUrl, acceptUrl])
  expect(request).toHaveBeenCalledWith(
    acceptUrl,
    expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
  )
})

it('接受后在 Hub 打开作品；查看可检查、播放、导出，但沙盒错误不能投递给作者 Agent', async () => {
  const { request, router } = openHub(invitation)
  fireEvent.click(await screen.findByRole('button', { name: '以 @sam 接受邀请' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cover' }))
  expect(router.state.location.href).toBe(`/a/${artifact.publicId}?shared=1`)
  expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Agent 对话' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '检查器' }))
  const inspector = within(screen.getByRole('dialog', { name: '检查器' }))
  expect(inspector.getByText('320 × 200')).toBeTruthy()
  expect(inspector.getByText('只读')).toBeTruthy()
  fireEvent.click(inspector.getByRole('button', { name: '关闭' }))
  fireEvent.click(screen.getByRole('button', { name: '播放原型：Cover' }))
  const player = within(screen.getByRole('region', { name: '交互预览' }))
  expect(player.getByTitle('画板内容：Cover').hasAttribute('inert')).toBe(false)
  fireEvent.click(player.getByRole('button', { name: '退出预览' }))
  const canvas = within(screen.getByRole('region', { name: '画布' }))
  const frame = sandbox(canvas.getByTitle<HTMLIFrameElement>('画板内容：Cover'))
  frame.receive({ type: 'ready' })
  frame.receive({ type: 'error', phase: 'runtime', message: 'Rendering error' })
  expect(await screen.findByText('Rendering error')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '交给 Agent 修复' })).toBeNull()
  fireEvent.click(canvas.getByRole('button', { name: '导出画板：Cover' }))
  expect(await screen.findByRole('combobox', { name: '导出范围' })).toBeTruthy()
  expect(request.mock.calls.some(([url]) => String(url).includes('/local-artifact/'))).toBe(false)
})

it('已开的协作工作区收到降权通知后移除编辑、保留批注；撤销后不再渲染缓存画面', async () => {
  const { changeAccess } = openHub(`/a/${artifact.publicId}`, { role: 'edit' })
  await screen.findByRole('button', { name: '设置画板：Cover' })
  changeAccess('comment')
  await waitFor(() => expect(screen.queryByRole('button', { name: '设置画板：Cover' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '批注' }))
  expect(await screen.findByRole('textbox', { name: '批注内容' })).toBeTruthy()
  changeAccess('view')
  await waitFor(() => expect(screen.queryByRole('textbox', { name: '批注内容' })).toBeNull())
  changeAccess('revoked')
  expect(await screen.findByText('作品不可用')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Cover' })).toBeNull()
})

it('失去所有者身份后按受邀范围重读讨论，不沿用作者缓存', async () => {
  const { changeAccess } = openHub(`/a/${artifact.publicId}`, { role: 'owner-only' })
  const toolbar = within(await screen.findByRole('banner'))
  fireEvent.click(await toolbar.findByRole('button', { name: /^批注(?: 1)?$/ }))
  expect(await screen.findByText(internal.body)).toBeTruthy()
  changeAccess('view')
  await waitFor(() => expect(screen.queryByText(internal.body)).toBeNull())
  expect(screen.getByRole('dialog', { name: '批注与评审' })).toBeTruthy()
})

it.each(['owner-only', 'revoked'] as const)(
  '书签已有缓存时，%s 仍向 Hub 查权且不自动探测本机',
  async (role) => {
    const { request } = openHub(`/a/${artifact.publicId}`, { role, cached: true })
    if (role === 'owner-only')
      expect(await screen.findByRole('button', { name: '分享' })).toBeTruthy()
    else {
      expect(await screen.findByText('作品不可用')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Cover' })).toBeNull()
    }
    expect(request.mock.calls.some(([url]) => String(url).includes('/local-artifact/'))).toBe(false)
  },
)
