// @vitest-environment jsdom
import type { ArtifactWorkspaceDetail } from '@akasha/protocol'
import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HubAccountButton } from '@/features/hub'
import { artifactKeys } from '../src/entities/artifact'
import { setLocale } from '../src/shared/i18n'
import { detail, openWorkspace } from './workspace-shell-fixture'

const { publicId, title, createdAt } = detail.artifact

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const journeys = [
  [
    'zh-CN',
    '简体中文',
    '更多批注选项',
    /查看全部批注/,
    '批注与评审',
    '关闭',
    '导出画板：确认订单',
    '导出范围',
  ],
  [
    'en',
    'English',
    'More comment options',
    /Show all comments/,
    'Comments and review',
    'Close',
    'Export artboard: 确认订单',
    'Export scope',
  ],
  [
    'de',
    'Deutsch',
    'Weitere Kommentaroptionen',
    /Alle Kommentare anzeigen/,
    'Kommentare und Review',
    'Schließen',
    'Zeichenfläche exportieren: 确认订单',
    'Exportumfang',
  ],
  [
    'ar',
    'العربية',
    'خيارات تعليقات إضافية',
    /عرض جميع التعليقات/,
    'التعليقات والمراجعة',
    'إغلاق',
    'تصدير لوحة الرسم: 确认订单',
    'نطاق التصدير',
  ],
] as const

it.each(journeys)(
  '%s 从作品库选板、审阅并导出同一份作者画稿',
  async (locale, name, commentMenu, showAllComments, panelTitle, close, exportAction, scope) => {
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
    const moreComments = within(screen.getByRole('banner')).getByRole('button', {
      name: commentMenu,
    })
    fireEvent.click(moreComments)
    fireEvent.click(await screen.findByRole('button', { name: showAllComments }))
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
  const openInHub = await screen.findByRole('link', { name: `打开协作画布：${title}` })
  const sharedPath = `/a/${publicId}?shared=1`
  const clipboard = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  })
  try {
    expect(screen.getByRole('link', { name: title }).getAttribute('href')).toBe(`/a/${publicId}`)
    expect(openInHub.getAttribute('href')).toBe(sharedPath)
    fireEvent.click(screen.getByRole('button', { name: '复制协作画布链接' }))
    await waitFor(() =>
      expect(clipboard).toHaveBeenCalledWith(new URL(sharedPath, location.origin).href),
    )
    fireEvent.click(openInHub)
    await waitFor(() => expect(router.state.location.href).toBe(sharedPath))
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
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

it('移动作品后原编辑器保留未保存源码和撤销历史，目标项目不沿用原管理权', async () => {
  Range.prototype.getClientRects ??= () => document.body.getClientRects()
  Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect()
  const { client, responses } = openWorkspace(true)
  const endpoint = `/api/v1/artifacts/${publicId}`
  const target = {
    id: 'second-project',
    name: '目标工作室',
    rootPath: '/studio',
    lastActiveAt: createdAt,
  }
  responses.set('/api/v1/projects', { projects: [target] })
  const destinationPermission = Promise.withResolvers<void>()
  const server = vi.mocked(fetch).getMockImplementation()
  if (!server) throw new Error('缺少工作台测试服务')
  let moved = false
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input), window.location.origin).pathname
    if (path === `${endpoint}/transfer` && init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ kind: 'move', targetProjectId: target.id })
      const artifact = { ...detail.artifact, projectId: target.id }
      responses.set(endpoint, {
        ...client.getQueryData<ArtifactWorkspaceDetail>(artifactKeys.canvas(publicId)),
        artifact,
      })
      moved = true
      return Response.json({ artifact })
    }
    if (moved && path === `${endpoint}/management`) {
      await destinationPermission.promise
      return Response.json({ canManage: false })
    }
    return server(input, init)
  })
  const menu = async (name: string) => {
    fireEvent.keyDown(await screen.findByRole('button', { name: '作品菜单' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name }))
  }
  await screen.findByRole('button', { name: '分享' })
  await menu('编辑代码')
  const editor = await screen.findByTestId('l3-code-editor')
  const field = within(editor).getByRole('textbox')
  const view = EditorView.findFromDOM(field)
  if (!view) throw new Error('代码编辑器未挂载')
  const draft = detail.version.source.replace('确认订单', '保留未保存修改')
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: draft } }))
  await screen.findByText('未保存')
  await menu('移动到项目…')
  const dialog = within(await screen.findByRole('dialog', { name: '移动作品' }))
  const projects = dialog.getByRole<HTMLButtonElement>('combobox', { name: '目标项目' })
  await waitFor(() => expect(projects.disabled).toBe(false))
  fireEvent.click(projects)
  fireEvent.click(await screen.findByRole('option', { name: target.name }))
  fireEvent.click(dialog.getByRole('button', { name: '移动' }))
  await waitFor(() =>
    expect(
      client.getQueryData<ArtifactWorkspaceDetail>(artifactKeys.canvas(publicId))?.artifact
        .projectId,
    ).toBe(target.id),
  )
  await waitFor(() => expect(screen.queryByRole('button', { name: '分享' })).toBeNull())
  const movedEditor = within(screen.getByTestId('l3-code-editor')).getByRole('textbox')
  expect(movedEditor.textContent).toContain('保留未保存修改')
  fireEvent.keyDown(movedEditor, { key: 'z', ctrlKey: true })
  await waitFor(() => expect(movedEditor.textContent).toBe(detail.version.source))
  await act(async () => destinationPermission.resolve())
  expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
})
