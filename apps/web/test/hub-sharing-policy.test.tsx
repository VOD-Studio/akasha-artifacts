// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HubSharingPolicyLauncher } from '../src/features/hub-sharing-policy'
import { createAppRouter } from '../src/routes/router'
import { setLocale } from '../src/shared/i18n'
import { stubResizeObserver } from './canvas-test-fixture'

const sessionUrl = '/api/v1/auth/session'
const artifactId = 'design-flow-42'
const policyUrl = `/api/v1/admin/sharing/${artifactId}`
const adminSession = {
  user: { login: 'root', userId: '7', member: true, kind: 'session', admin: true },
}
const memberSession = {
  user: { login: 'sam', userId: '5', member: true, kind: 'session', admin: false },
}
const initialPolicy = {
  defaults: { externalLinks: true, externalEmail: false },
  override: { externalLinks: null, externalEmail: null },
}

interface SessionResponse {
  user: { login: string; admin: boolean } | null
}

interface PolicyPageOptions {
  session?: SessionResponse
  policy?: typeof initialPolicy
  /** GET 策略返回的状态码；不设则返回策略。 */
  getStatus?: number
  /** PUT 策略返回的状态码；不设则接受提交。 */
  putStatus?: number
}

function openPolicyPage(options: PolicyPageOptions = {}) {
  stubResizeObserver()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  let session: SessionResponse = options.session ?? adminSession
  let policy = options.policy ?? initialPolicy
  let getStatus = options.getStatus
  const puts: { url: string; body: Record<string, unknown> }[] = []
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const { pathname } = new URL(String(input), window.location.origin)
    if (pathname === sessionUrl) return Response.json(session)
    if (pathname === policyUrl) {
      const body = init?.body ? JSON.parse(String(init.body)) : null
      if (init?.method === 'PUT') {
        puts.push({ url: pathname, body: body ?? {} })
        if (options.putStatus) return new Response(null, { status: options.putStatus })
        policy = { ...policy, ...body }
        return Response.json(policy)
      }
      if (getStatus) return new Response(null, { status: getStatus })
      return Response.json(policy)
    }
    return new Response(null, { status: 404 })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [`/admin/sharing/${artifactId}`] }),
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return {
    request,
    puts,
    client,
    setSession: (next: SessionResponse) => {
      session = next
    },
    setGetStatus: (status?: number) => {
      getStatus = status
    },
  }
}

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('未登录时给出可安全返回的登录，不读取策略或作品', async () => {
  setLocale('en')
  const { request } = openPolicyPage({ session: { user: null } })
  const signIn = await screen.findByRole('link', { name: 'Sign in with GitHub' })
  expect(signIn.getAttribute('href')).toBe(
    `/auth/login?next=${encodeURIComponent(`/admin/sharing/${artifactId}`)}`,
  )
  expect(screen.getByText('Only Hub administrators can use this page')).toBeTruthy()
  act(() => setLocale('ar'))
  expect(screen.getByRole('heading', { name: 'سياسة المشاركة' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'تسجيل الدخول باستخدام GitHub' })).toBeTruthy()
  expect(request.mock.calls.map(([url]) => String(url))).toEqual([sessionUrl])
})

it('非管理员收到无权限反馈与返回库入口，仍不读取策略', async () => {
  const { request } = openPolicyPage({ session: memberSession })
  expect(await screen.findByText('当前账号不是 Hub 管理员')).toBeTruthy()
  expect(screen.getByRole('link', { name: '返回作品库' }).getAttribute('href')).toBe('/')
  expect(screen.queryByRole('switch')).toBeNull()
  expect(request.mock.calls.map(([url]) => String(url))).toEqual([sessionUrl])
})

it('管理员分别提交 Hub 默认值与作品例外，全程不请求作品内容', async () => {
  const { request, puts } = openPolicyPage()
  const links = await screen.findByRole('switch', { name: '外发链接' })
  const email = screen.getByRole('switch', { name: '外部邮箱' })
  expect(links.getAttribute('aria-checked')).toBe('true')
  expect(email.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByText('当前默认：允许')).toBeTruthy()
  expect(screen.getByText('当前默认：禁止')).toBeTruthy()
  fireEvent.click(email)
  await waitFor(() => expect(email.getAttribute('aria-checked')).toBe('true'))
  expect(screen.getAllByText('当前默认：允许')).toHaveLength(2)
  const emailException = screen.getByRole('combobox', { name: '外部邮箱' })
  fireEvent.click(emailException)
  fireEvent.click(await screen.findByRole('option', { name: '禁止' }))
  await waitFor(() => expect(puts.length).toBe(2))
  const linkException = screen.getByRole('combobox', { name: '外发链接' })
  fireEvent.click(linkException)
  fireEvent.click(await screen.findByRole('option', { name: '允许' }))
  await waitFor(() => expect(puts.length).toBe(3))
  expect(puts).toEqual([
    { url: policyUrl, body: { defaults: { externalLinks: true, externalEmail: true } } },
    { url: policyUrl, body: { override: { externalLinks: null, externalEmail: false } } },
    { url: policyUrl, body: { override: { externalLinks: true, externalEmail: false } } },
  ])
  expect(request.mock.calls.map(([url]) => String(url))).toEqual([
    sessionUrl,
    policyUrl,
    policyUrl,
    policyUrl,
    policyUrl,
  ])
  expect(request).toHaveBeenCalledWith(
    policyUrl,
    expect.objectContaining({ method: 'PUT', credentials: 'same-origin' }),
  )
})

it('保存失败回滚开关并说明原因，失败不当作已保存', async () => {
  setLocale('en')
  const { puts } = openPolicyPage({ putStatus: 500 })
  const links = await screen.findByRole('switch', { name: 'External links' })
  fireEvent.click(links)
  expect(
    await screen.findByText('Could not save: The service is temporarily unavailable.'),
  ).toBeTruthy()
  await waitFor(() => expect(links.getAttribute('aria-checked')).toBe('true'))
  expect(puts).toEqual([
    { url: policyUrl, body: { defaults: { externalLinks: false, externalEmail: false } } },
  ])
})

it('读取策略失败时显示原因与重试，不把失败当作空策略', async () => {
  const { request } = openPolicyPage({ getStatus: 404 })
  expect(await screen.findByText(/^无法读取分享策略：/)).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  const callsBeforeRetry = request.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await waitFor(() => expect(request.mock.calls.length).toBe(callsBeforeRetry + 2))
})

it('已有策略时刷新失败会收起编辑器，只保留错误与重试', async () => {
  const { client, setGetStatus } = openPolicyPage()
  expect(await screen.findByRole('switch', { name: '外发链接' })).toBeTruthy()
  setGetStatus(404)
  await act(async () => {
    await client.refetchQueries({ queryKey: ['hub-admin-sharing', artifactId] })
  })
  expect(await screen.findByText(/^无法读取分享策略：/)).toBeTruthy()
  expect(screen.queryAllByRole('switch')).toHaveLength(0)
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)
})

it('写请求被拒后重读身份，回到登录反馈并收起编辑器', async () => {
  const { setSession } = openPolicyPage({ putStatus: 401 })
  const email = await screen.findByRole('switch', { name: '外部邮箱' })
  setSession({ user: null })
  fireEvent.click(email)
  const signIn = await screen.findByRole('link', { name: '使用 GitHub 登录' })
  expect(signIn.getAttribute('href')).toBe(
    `/auth/login?next=${encodeURIComponent(`/admin/sharing/${artifactId}`)}`,
  )
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.getByText('仅 Hub 管理员可用')).toBeTruthy()
})

it('库页入口按输入的作品 ID 生成策略页地址，不依赖作品列表', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HubSharingPolicyLauncher />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '分享策略' }))
  const input = await screen.findByRole('textbox', { name: '作品 ID' })
  expect(screen.getByRole('button', { name: '打开' }).hasAttribute('disabled')).toBe(true)
  fireEvent.change(input, { target: { value: `${artifactId} ` } })
  expect(screen.getByRole('link', { name: '打开' }).getAttribute('href')).toBe(
    `/admin/sharing/${artifactId}`,
  )
  expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  act(() => setLocale('de'))
  expect(
    screen.getByRole('dialog', { name: 'Freigabe-Richtlinie eines Werks öffnen' }),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(await screen.findByRole('button', { name: 'Freigabe-Richtlinie' })).toBeTruthy()
})
