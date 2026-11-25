// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createAppRouter } from '../src/routes/router'
import {
  artifact,
  design,
  detailFor,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  workspace,
} from './canvas-test-fixture'

setupCanvasTest()

function openPageMenu(title: string) {
  const trigger = screen.getByRole('button', { name: `更多页面操作：${title}` })
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  return within(screen.getByRole('menu'))
}

it('跨页查找、热更新和刷新都保留仍在的选板与倍率', () => {
  const opened = showWorkspace()
  const title = screen.getByRole('button', { name: '手机首页' })
  fireEvent.click(title)
  expect(screen.getByTitle('画板内容：手机首页').hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(title, { key: 'Escape' })
  expect(title.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '手机首页' }))
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const zoomed = screen.getByLabelText('画布缩放比例').textContent

  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.change(screen.getByLabelText('搜索页面或画板'), { target: { value: '预约完成' } })
  fireEvent.click(screen.getByRole('button', { name: '预约完成' }))
  expect(screen.getByTitle('画板内容：预约完成')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()

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
  const originalFrame = screen.getByTitle('画板内容：手机首页')
  opened.update(workspace(next))
  expect(screen.getByTitle('画板内容：手机首页新版')).toBe(originalFrame)
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
    if (url.pathname === `${endpoint}/feedback`) return Response.json({ items: [] })
    if (url.pathname === '/api/v1/daemon/status') return Response.json({ sandboxPort: 24331 })
    if (url.pathname === '/api/v1/projects') return Response.json({ projects: [] })
    if (url.pathname === '/api/v1/artifacts') return Response.json({ artifacts: [] })
    if (url.pathname === '/api/v1/favorites') return Response.json({ artifactIds: [] })
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
    expect(await screen.findByTitle('画板内容：预约完成')).toBeTruthy()
    expect(screen.queryByTitle('画板内容：新版确认页')).toBeNull()
    expect(screen.queryByTitle('画板内容：宽屏首页')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
    expect(screen.queryByRole('button', { name: '新建页面' })).toBeNull()
    const menu = openPageMenu('预约流程')
    expect(menu.queryByRole('menuitem', { name: '重命名页面' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: '删除页面' })).toBeNull()
    fireEvent.click(menu.getByRole('menuitem', { name: '复制页面链接' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/a/${artifact.publicId}/v/1#page=reserve`,
      ),
    )

    await router.navigate({
      to: '/a/$publicId/v/$version',
      params: { publicId: artifact.publicId, version: '1' },
      search: true,
      resetScroll: false,
      hash: 'page=status&board=missing',
    })
    expect((await screen.findByRole('alert')).textContent).toContain('链接中的画板不存在')
    expect(screen.queryByTitle('画板内容：预约完成')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }))
    expect(await screen.findByTitle('画板内容：预约完成')).toBeTruthy()
    expect(router.state.location.search).toMatchObject({ share: 'test-token' })
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
})

it('新建页面保存为头版本，空页不继承未分组画板', async () => {
  const editor = showEditableWorkspace(
    detailFor(
      1,
      JSON.stringify({ boards: [{ id: 'cover', title: '旧画板', html: '<h1>旧内容</h1>' }] }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '新建页面' }))
  fireEvent.change(screen.getByRole('textbox', { name: '页面名称' }), { target: { value: '备忘' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))

  expect(await screen.findByText('此页面没有画板')).toBeTruthy()
  expect(editor.submittedVersion).toBe(1)
  expect(screen.queryByTitle('画板内容：旧画板')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '旧画板' }))
  expect(screen.getByTitle('画板内容：旧画板')).toBeTruthy()
})

it('沿用旧页定位链接完成重命名，确认删除时只移除该页直属画板', async () => {
  const initial = detailFor(
    1,
    JSON.stringify({
      pages: [{ title: '旧预约' }, { id: 'keep', title: '保留页' }],
      boards: [
        { title: '要移除的画板', pageId: 'page-1' },
        { title: '要保留的画板', pageId: 'keep' },
        { id: 'shared', title: '共享画板' },
      ],
      flows: [{ from: 'board-1', to: 'board-2' }],
    }),
  )
  const address = new URLSearchParams({ page: 'legacy-page:旧预约' }).toString()
  const editor = showEditableWorkspace(initial, address)
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(openPageMenu('旧预约').getByRole('menuitem', { name: '重命名页面' }))
  fireEvent.change(screen.getByRole('textbox', { name: '页面名称' }), {
    target: { value: '新预约' },
  })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '页面与画板' }).textContent).toBe('新预约'),
  )
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()

  fireEvent.click(openPageMenu('新预约').getByRole('menuitem', { name: '删除页面' }))
  expect(screen.getByText(/1 张直属画板/)).toBeTruthy()
  expect(screen.getByTitle('画板内容：要移除的画板')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(await screen.findByTitle('画板内容：要保留的画板')).toBeTruthy()
  expect(screen.getByTitle('画板内容：共享画板')).toBeTruthy()
  expect(screen.queryByTitle('画板内容：要移除的画板')).toBeNull()
  expect(JSON.parse(editor.current.version.source)).toMatchObject({ flows: [] })
})

it('页面分组显示未过滤的总数，管理另一页不改变当前选板和倍率', async () => {
  const source = { ...design, pages: [{ id: 'draft', title: '草案' }, ...design.pages] }
  const refresh = Promise.withResolvers<void>()
  const editor = showEditableWorkspace(
    detailFor(1, JSON.stringify(source)),
    'page=reserve',
    refresh.promise,
  )
  fireEvent.click(screen.getByRole('button', { name: '手机首页' }))
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const zoom = screen.getByLabelText('画布缩放比例').textContent
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  const search = screen.getByRole('searchbox', { name: '搜索页面或画板' })
  fireEvent.change(search, { target: { value: '手机' } })
  const group = within(screen.getByRole('group', { name: '预约流程' }))
  expect(group.getByText('2 张画板')).toBeTruthy()
  expect(group.queryByRole('button', { name: '宽屏首页' })).toBeNull()
  expect(group.getByRole('button', { name: '手机首页', pressed: true })).toBeTruthy()
  fireEvent.change(search, { target: { value: '' } })

  fireEvent.click(openPageMenu('状态').getByRole('menuitem', { name: '删除页面' }))
  const dialog = within(screen.getByRole('dialog', { name: '删除页面' }))
  expect(dialog.getByText(/删除「状态」及其 1 张直属画板/)).toBeTruthy()
  fireEvent.click(dialog.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(screen.getByRole('group', { name: '状态' })).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(search))
  await act(async () => refresh.resolve())
  expect(screen.queryByRole('group', { name: '状态' })).toBeNull()
  expect(document.activeElement).toBe(search)
  fireEvent.keyDown(search, { key: 'Escape' })
  const canvas = within(screen.getByRole('region', { name: '画布' }))
  expect(canvas.getByRole('button', { name: '手机首页', pressed: true })).toBeTruthy()
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoom)
})

it('仅查看时能从页面菜单逐层用 Escape 退出，焦点回到打开它的按钮', async () => {
  showWorkspace({ ...detailFor(), access: { role: 'view', expiresAt: '2099-01-01T00:00:00Z' } })
  const navigator = screen.getByRole('button', { name: '页面与画板' })
  fireEvent.click(navigator)
  expect(screen.queryByRole('button', { name: '新建页面' })).toBeNull()
  const menu = openPageMenu('状态')
  expect(menu.queryByRole('menuitem', { name: '重命名页面' })).toBeNull()
  expect(menu.queryByRole('menuitem', { name: '删除页面' })).toBeNull()
  fireEvent.keyDown(menu.getByRole('menuitem', { name: '复制页面链接' }), { key: 'Escape' })
  const more = screen.getByRole('button', { name: '更多页面操作：状态' })
  await waitFor(() => expect(document.activeElement).toBe(more))
  fireEvent.keyDown(more, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(navigator))
})

it('双轴滚动平移画布，只有带缩放修饰键的滚轮才改变倍率', () => {
  showWorkspace()
  const viewport = screen.getByRole('region', { name: '画布' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  const board = title.closest<HTMLElement>('.artifact-canvas-board')
  if (!board) throw new Error('缺少画板')
  fireEvent.click(title)
  const zoom = screen.getByLabelText('画布缩放比例')
  const initial = zoom.textContent
  const left = Number.parseFloat(board.style.left)
  const top = Number.parseFloat(board.style.top)
  fireEvent.wheel(viewport, { deltaX: 70, deltaY: 45 })
  expect(Number.parseFloat(board.style.left)).toBe(left - 70)
  expect(Number.parseFloat(board.style.top)).toBe(top - 45)
  expect(zoom.textContent).toBe(initial)
  fireEvent.wheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 700, clientY: 400 })
  expect(Number.parseFloat(zoom.textContent ?? '')).toBeGreaterThan(
    Number.parseFloat(initial ?? ''),
  )
  expect(title.getAttribute('aria-pressed')).toBe('true')
})
