// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createAppRouter } from '../src/routes/router'
import { artifact, detailFor, setupCanvasTest, stubResizeObserver } from './canvas-test-fixture'

setupCanvasTest()

it.each(['本机固定版', '仅查看分享', '可写头版'] as const)(
  '%s 从作品和板头导出时按当前画布排列非连续选区，不把单板当作选区',
  async (scope) => {
    stubResizeObserver()
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }))
    const fixed = detailFor(
      1,
      JSON.stringify({
        columns: 2,
        boards: ['甲板', '乙板', '丙板'].map((title, index) => ({
          id: `board-${index}`,
          title,
          viewport: { width: 320, height: 200 },
          position: index === 0 ? { x: 0, y: 450 } : undefined,
          html: `<h1>${title}</h1>`,
        })),
      }),
    )
    const shared = scope === '仅查看分享'
    const live = scope === '可写头版'
    const endpoint = `/api/v1/artifacts/${artifact.publicId}`
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const { pathname } = new URL(String(input), window.location.origin)
      if (pathname === endpoint) {
        return Response.json({
          ...fixed,
          state: { ...fixed.state, snapshot: { props: { columns: 1 } } },
          artifact: { ...artifact, headVersion: live ? 1 : 2 },
          access: shared
            ? { role: 'view', version: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }
            : undefined,
        })
      }
      if (pathname === `${endpoint}/versions`) return Response.json({ versions: [fixed.version] })
      if (pathname === `${endpoint}/feedback`) return Response.json({ items: [] })
      if (pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
      if (pathname === '/api/v1/projects') return Response.json({ projects: [] })
      if (pathname === '/api/v1/artifacts') return Response.json({ artifacts: [] })
      if (pathname === '/api/v1/favorites') return Response.json({ artifactIds: [] })
      return Response.json({ selection: null })
    })
    const router = createAppRouter(
      createMemoryHistory({
        initialEntries: [
          `/a/${artifact.publicId}${live ? '' : '/v/1'}${shared ? '?shared=1' : ''}`,
        ],
      }),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )
    const exportBoard = await screen.findByRole('button', { name: '导出画板：乙板' })
    const ranges = () => screen.getByRole('combobox', { name: '导出范围' })
    const openWorkMenu = () => {
      fireEvent.keyDown(screen.getByRole('button', { name: '作品菜单' }), { key: 'Enter' })
      fireEvent.click(screen.getByRole('menuitem', { name: '导出' }))
    }
    fireEvent.click(exportBoard)
    expect(ranges().textContent).toContain('乙板')
    fireEvent.click(ranges())
    const empty = await screen.findByRole('option', { name: '选中画板（0 张）' })
    expect(empty.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /乙板/ }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.activeElement).toBe(exportBoard))

    fireEvent.click(screen.getByRole('button', { name: '丙板' }))
    fireEvent.click(screen.getByRole('button', { name: '甲板' }), { shiftKey: true })
    for (const boardEntry of [false, true]) {
      if (boardEntry) fireEvent.click(exportBoard)
      else openWorkMenu()
      const range = await screen.findByRole('combobox', { name: '导出范围' })
      expect(range.textContent).toContain(boardEntry ? '乙板' : '整份作品（3 张）')
      fireEvent.click(range)
      fireEvent.click(await screen.findByRole('option', { name: '选中画板（2 张）' }))
      const order = within(await screen.findByRole('list', { name: '选区 PDF 页序' }))
      expect(order.getAllByRole('listitem').map((item) => item.textContent)).toEqual(
        live ? ['甲板', '丙板'] : ['丙板', '甲板'],
      )
      fireEvent.click(screen.getByRole('button', { name: '取消' }))
      if (!boardEntry) {
        await waitFor(() =>
          expect(document.activeElement).toBe(screen.getByRole('button', { name: '作品菜单' })),
        )
      }
    }
    const writes = request.mock.calls.flatMap(([url, options]) =>
      options?.method && options.method !== 'GET' ? [`${options.method} ${url}`] : [],
    )
    expect([...new Set(writes)]).toEqual(
      live ? [`POST /api/v1/projects/${artifact.projectId}/selection`] : [],
    )
  },
)
