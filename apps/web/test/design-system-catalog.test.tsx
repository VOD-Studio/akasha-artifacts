// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact'
import { projectKeys } from '../src/entities/project'
import { LibraryShell } from '../src/widgets/LibraryShell'
import { stubResizeObserver } from './canvas-test-fixture'

const item = {
  id: 'CanvasExamplePublicId1',
  version: 2,
  title: 'Brand kit',
  components: [{ path: 'Button.tsx', exportName: 'Button' }],
  guidance: { fontFamily: 'serif', color: '#333', spacing: 12, instructions: '' },
}
const catalog = '/api/v1/projects/alpha/system-catalog'

function showLibrary(admin: boolean, hub = true, multipleProjects = false) {
  stubResizeObserver()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub })
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const projects = [{ id: 'alpha', name: 'Alpha', dormant: false }]
  if (multipleProjects) projects.push({ id: 'beta', name: 'Beta', dormant: false })
  cache.setQueryData(projectKeys.all, projects)
  cache.setQueryData(artifactKeys.list(undefined), [])
  let publication = admin ? 'private' : 'team'
  let isDefault = !admin
  const writes: unknown[] = []
  let betaReads = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/session'))
      return Response.json({ user: { member: true, admin, login: 'ada', kind: 'session' } })
    if (url === catalog) return Response.json({ items: [{ ...item, publication, isDefault }] })
    if (url === '/api/v1/projects/beta/system-catalog') {
      betaReads++
      return betaReads === 1 ? new Response(null, { status: 503 }) : Response.json({ items: [] })
    }
    if (url === `${catalog}/${item.id}/2/publication` && init?.method === 'PUT') {
      const { action } = JSON.parse(String(init.body))
      writes.push(action)
      if (action === 'publish') publication = 'team'
      if (action === 'withdraw') publication = 'private'
      isDefault = action === 'default'
      return Response.json({ ok: true })
    }
    return new Response(null, { status: 404 })
  })
  render(
    <QueryClientProvider client={cache}>
      <LibraryShell onOpenArtifact={vi.fn()} />
    </QueryClientProvider>,
  )
  return writes
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('成员在项目目录看到固定版本、组件和默认标记，不获得发布按钮或来源链接', async () => {
  showLibrary(false)
  fireEvent.click(await screen.findByRole('button', { name: '系统目录' }))
  const dialog = within(await screen.findByRole('dialog'))
  await dialog.findByText('Brand kit')
  for (const text of [item.id, 'v2', 'Button.tsx#Button', '团队默认'])
    expect(dialog.getByText(text)).toBeDefined()
  expect(dialog.queryByRole('link')).toBeNull()
  expect(dialog.queryByRole('button', { name: '撤回' })).toBeNull()
})

it('管理员从真实库页发布、设为默认、撤销默认、撤回同一个固定版本', async () => {
  const writes = showLibrary(true)
  fireEvent.click(await screen.findByRole('button', { name: '系统目录' }))
  for (const name of ['发布到团队', '设为默认', '撤销默认', '撤回']) {
    const button = await screen.findByRole<HTMLButtonElement>('button', { name })
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
  }
  await screen.findByRole('button', { name: '发布到团队' })
  expect(writes).toEqual(['publish', 'default', 'clear-default', 'withdraw'])
})

it('本地库没有 Hub 系统目录入口', () => {
  showLibrary(false, false)
  expect(screen.queryByRole('button', { name: '系统目录' })).toBeNull()
})

it('切换项目立即清除旧目录；读取失败可重试并区分空目录', async () => {
  showLibrary(false, true, true)
  fireEvent.click(await screen.findByRole('button', { name: '系统目录' }))
  const dialog = within(await screen.findByRole('dialog'))
  const picker = dialog.getByRole('combobox', { name: '项目' })
  fireEvent.click(picker)
  fireEvent.click(await screen.findByRole('option', { name: 'Alpha' }))
  await dialog.findByText('Brand kit')
  fireEvent.click(picker)
  fireEvent.click(await screen.findByRole('option', { name: 'Beta' }))
  expect(dialog.queryByText('Brand kit')).toBeNull()
  fireEvent.click(await dialog.findByRole('button', { name: '重试' }))
  await dialog.findByText('无可用系统版本')
})
