// @vitest-environment jsdom
import type { ArtifactWorkspaceDetail, DesignSystemSnapshot } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemWorkspace } from '../src/features/design-system/ui/SystemWorkspace'
import { detailFor } from './canvas-test-fixture'

const snapshot: DesignSystemSnapshot = {
  draft: {
    origin: { kind: 'local', label: '独立品牌' },
    files: [{ kind: 'guidelines', path: 'brand.md', content: '保留字距' }],
    guidance: { color: '#333', fontFamily: 'serif', spacing: 12, instructions: '正文使用衬线字体' },
    components: [],
  },
  sourceVersion: 'a'.repeat(64),
  previewSource: 'export default function Brand() { return <p>独立品牌</p> }',
  compiledRanges: [],
}

afterEach(() => {
  cleanup()
  delete window.__AKASHA_CONFIG__
  vi.restoreAllMocks()
})

it('分享读者不请求管理权，设计系统移动后须按目标项目重新授权', async () => {
  const detail = detailFor(1, JSON.stringify(snapshot))
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ canManage: true }))
    .mockResolvedValueOnce(Response.json({ canManage: false }))
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const workspace = (projectId: string, access?: ArtifactWorkspaceDetail['access']) => (
    <QueryClientProvider client={cache}>
      <SystemWorkspace
        detail={{
          ...detail,
          artifact: { ...detail.artifact, type: 'design-system', projectId },
          access,
        }}
        versions={[]}
        sandboxOrigin="http://sandbox.test"
        onBack={vi.fn()}
        onVersion={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    </QueryClientProvider>
  )
  window.__AKASHA_CONFIG__ = { hub: true }
  const view = render(workspace('source', { role: 'view', expiresAt: '2099-01-01T00:00:00Z' }))
  expect(screen.getByText('独立品牌')).toBeDefined()
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByRole('group', { name: /共享此版本/ })).toBeNull()
  window.__AKASHA_CONFIG__ = { hub: false }
  view.rerender(workspace('source'))
  await screen.findByRole('button', { name: '重新同步' })
  expect(screen.queryByRole('group', { name: /共享此版本/ })).toBeNull()
  window.__AKASHA_CONFIG__ = { hub: true }
  view.rerender(workspace('destination'))
  expect(screen.queryByRole('button', { name: '重新同步' })).toBeNull()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: '生成画板' })).toBeNull()
  expect(screen.queryByRole('group', { name: /共享此版本/ })).toBeNull()
})

it('Hub 所有者读取、替换并清空正在查看的固定版本名单；失败时保留草稿', async () => {
  window.__AKASHA_CONFIG__ = { hub: true }
  const detail = detailFor(2, JSON.stringify(snapshot))
  const { promise: pending, resolve: finishRead } = Promise.withResolvers<Response>()
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ canManage: true }))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(Response.json({ logins: ['old-member'] }))
    .mockResolvedValueOnce(new Response(null, { status: 400 }))
    .mockResolvedValueOnce(Response.json({ logins: ['ada', 'lin'] }))
    .mockResolvedValueOnce(Response.json({ logins: [] }))
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  cache.setQueryData(['hub-session'], { user: { member: true, admin: false } })
  render(
    <QueryClientProvider client={cache}>
      <SystemWorkspace
        detail={{
          ...detail,
          artifact: { ...detail.artifact, headVersion: 3, type: 'design-system' },
        }}
        fixedVersion={2}
        versions={[]}
        sandboxOrigin="http://sandbox.test"
        onBack={vi.fn()}
        onVersion={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    </QueryClientProvider>,
  )
  await screen.findByText('正在读取')
  expect(screen.queryByRole('button', { name: '保存名单' })).toBeNull()
  finishRead(new Response(null, { status: 503 }))
  fireEvent.click(await screen.findByRole('button', { name: '重试' }))
  const input = await screen.findByDisplayValue('old-member')
  const path = `/api/v1/projects/project-canvas/system-catalog/${detail.artifact.publicId}/2/members`
  expect(fetcher.mock.calls[1]?.[0]).toBe(path)
  fireEvent.change(input, { target: { value: 'ada\nlin' } })
  const save = screen.getByRole('button', { name: '保存名单' })
  fireEvent.click(save)
  await screen.findByRole('alert')
  expect((input as HTMLTextAreaElement).value).toBe('ada\nlin')
  fireEvent.click(save)
  await waitFor(() => {
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(input.closest('fieldset')?.disabled).toBe(false)
  })
  expect(fetcher).toHaveBeenCalledWith(
    path,
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ logins: ['ada', 'lin'] }) }),
  )
  fireEvent.change(input, { target: { value: '' } })
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByText('尚未点名共享')
  expect(fetcher).toHaveBeenLastCalledWith(
    path,
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ logins: [] }) }),
  )
})

it('管理员从本人来源工作区发布未在目录列出的历史版本', async () => {
  window.__AKASHA_CONFIG__ = { hub: true }
  const detail = detailFor(2, JSON.stringify(snapshot))
  const calls: string[] = []
  const path = `/api/v1/projects/project-canvas/system-catalog/${detail.artifact.publicId}/2/publication`
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/management')) return Response.json({ canManage: true })
    if (url.endsWith('/members')) return Response.json({ logins: [] })
    if (url.endsWith('/auth/session')) return Response.json({ user: { member: true, admin: true } })
    if (url.endsWith('/system-catalog')) return Response.json({ inheritDefault: true, items: [] })
    if (url === path && init?.method === 'PUT') return Response.json({ ok: true })
    return new Response(null, { status: 404 })
  })
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={cache}>
      <SystemWorkspace
        detail={{
          ...detail,
          artifact: { ...detail.artifact, headVersion: 3, type: 'design-system' },
        }}
        fixedVersion={2}
        versions={[]}
        sandboxOrigin="http://sandbox.test"
        onBack={vi.fn()}
        onVersion={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '发布到团队' }))
  await waitFor(() =>
    expect(calls.filter((url) => url.endsWith('/system-catalog'))).toHaveLength(2),
  )
  expect(fetcher).toHaveBeenCalledWith(
    path,
    expect.objectContaining({ method: 'PUT', body: '{"action":"publish"}' }),
  )
})
