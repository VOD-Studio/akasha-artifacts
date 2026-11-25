// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { LibraryShell } from '../src/widgets/LibraryShell'
import { useLibraryView } from '../src/widgets/LibraryShell/model/library-view'

const artifact = {
  publicId: 'aLocalLibraryExample01',
  projectId: 'project',
  slug: 'design/sample',
  title: 'سفر · 作者的旅行',
  type: 'artboard',
  visibility: 'private',
  headVersion: 4,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T12:00:00Z',
}
const project = {
  id: 'project',
  name: 'Reise',
  rootPath: '/tmp/reise',
  lastActiveAt: artifact.updatedAt,
}

function openLibrary() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={client}>
      <LibraryShell onOpenArtifact={vi.fn()} />
    </QueryClientProvider>,
  )
}

async function switchLanguage(currentLabel: string | RegExp, name: string) {
  const trigger = screen.getByRole('button', { name: currentLabel })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name }))
  await waitFor(() => expect(document.activeElement).toBe(trigger))
}

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  useLibraryView.setState(useLibraryView.getInitialState())
  vi.unstubAllGlobals()
})

it('访客在同一库页切换语言、恢复语言并清除搜索，不翻译作者标题或发送写请求', async () => {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  const methods: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    methods.push(init?.method ?? 'GET')
    switch (url) {
      case '/api/v1/artifacts':
        return Promise.resolve(Response.json({ artifacts: [artifact] }))
      case '/api/v1/projects':
        return Promise.resolve(Response.json({ projects: [] }))
      case '/api/v1/auth/session':
        return Promise.resolve(Response.json({ user: null }))
      default:
        return Promise.resolve(new Response(null, { status: 403 }))
    }
  })
  const href = location.href
  openLibrary()
  const link = await screen.findByRole('link', { name: artifact.title })
  const path = link.getAttribute('href')
  const search = screen.getByRole<HTMLInputElement>('searchbox', { name: '搜索作品' })
  fireEvent.change(search, { target: { value: 'unmatched-search' } })
  await screen.findByText('未找到作品')
  await switchLanguage('界面语言', 'English')
  expect(screen.getByText('No artifacts found')).toBeTruthy()
  expect(screen.getByRole('searchbox', { name: 'Search artifacts' })).toBe(search)
  expect(search.value).toBe('unmatched-search')
  await switchLanguage(/language/i, 'Deutsch')
  expect(screen.getByText('Keine Werke gefunden')).toBeTruthy()
  expect(screen.getByRole('searchbox', { name: 'Werke durchsuchen' })).toBe(search)
  await switchLanguage('Oberflächensprache', 'العربية')
  expect(screen.getByText('لم يتم العثور على أعمال')).toBeTruthy()
  expect(search.value).toBe('unmatched-search')
  fireEvent.click(screen.getByRole('button', { name: 'مسح البحث' }))
  expect(search.value).toBe('')
  expect(screen.getByRole('link', { name: artifact.title }).getAttribute('href')).toBe(path)
  expect(screen.getByText('تصميم')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'تصميم جديد' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'إدارة مكتبة الأعمال' })).toBeNull()
  await switchLanguage('لغة الواجهة', '简体中文')
  expect(screen.getByRole('searchbox', { name: '搜索作品' })).toBe(search)
  expect(location.href).toBe(href)
  expect(methods.length).toBeGreaterThan(0)
  expect(methods.every((method) => method === 'GET')).toBe(true)
})

it.each([
  ['未授权', 403],
  ['没有连接', 200],
] as const)('本机%s：加载不会先显示空库，空库没有创建入口', async (_, status) => {
  const list = Promise.withResolvers<Response>()
  const requests: string[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`)
    switch (url) {
      case '/api/v1/artifacts':
        return list.promise
      case '/api/v1/projects':
        return Promise.resolve(Response.json({ projects: [project] }))
      case '/api/v1/agent/connections':
        return Promise.resolve(Response.json({ connections: [] }, { status }))
      default:
        return Promise.resolve(new Response(null, { status: 403 }))
    }
  })
  openLibrary()
  const results = screen.getByRole('region', { name: '作品列表' })
  expect(results.getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByText('还没有作品')).toBeNull()
  expect(screen.queryByRole('button', { name: '新建设计' })).toBeNull()
  await act(async () => list.resolve(Response.json({ artifacts: [] })))
  await screen.findByText('还没有作品')
  expect(results.getAttribute('aria-busy')).toBe('false')
  expect(screen.queryByRole('button', { name: '新建设计' })).toBeNull()
  if (status === 403) expect(screen.queryByRole('button', { name: '管理作品库' })).toBeNull()
  expect(requests).toContain('GET /api/v1/agent/connections')
  expect(requests.every((request) => request.startsWith('GET '))).toBe(true)
})
