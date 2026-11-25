// @vitest-environment jsdom
import { projectArtboard } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import { createAppRouter } from '../src/routes/router'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { artifact, detailFor, setupCanvasTest, showWorkspace } from './canvas-test-fixture'

setupCanvasTest()

it('切版读取源码期间隐藏旧版的保存入口，加载后打开当前版本', async () => {
  const next = detailFor(
    2,
    JSON.stringify({ boards: [{ id: 'next', title: '下一版', html: '<h1>新稿</h1>' }] }),
  )
  const projection = projectArtboard(next.version.source, 2)
  if (!projection) throw new Error('测试画稿未投影')
  const { source: _source, ...summary } = next.version
  const pending = Promise.withResolvers<Response>()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname.endsWith('/boards')) {
      return Response.json({
        artifactId: artifact.publicId,
        version: 2,
        board: projection.contents[0],
      })
    }
    if (url.pathname.endsWith(artifact.publicId) && url.search === '?version=2') {
      return await pending.promise
    }
    return Response.json({})
  })
  useWorkspaceStore.getState().setViewMode('edit')
  const view = showWorkspace()
  const editor = screen.getByRole('region', { name: '代码编辑区' })
  view.update(
    <ArtifactWorkspace
      detail={{ ...next, version: summary, canvas: projection.index }}
      versions={[summary]}
      sandboxOrigin="http://127.0.0.1:24331"
    />,
  )
  expect(screen.getByText('正在读取源码…')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '代码编辑区' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^保存/ })).toBeNull()
  pending.resolve(Response.json(next))
  expect(await screen.findByRole('region', { name: '代码编辑区' })).toBe(editor)
  expect(screen.getByTestId('l3-code-editor').textContent).toContain('v2')
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
