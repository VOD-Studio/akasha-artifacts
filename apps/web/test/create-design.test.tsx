// @vitest-environment jsdom
import type { AgentConversation, Project } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateDesignDialog } from '../src/widgets/LibraryShell/CreateDesignDialog'
import { LibraryShell } from '../src/widgets/LibraryShell/LibraryShell'

const projects: Project[] = [
  { id: 'p-alpha', rootPath: '/tmp/alpha', name: '预约项目', lastActiveAt: '2026-11-23T00:00:00Z' },
  { id: 'p-beta', rootPath: '/tmp/beta', name: '未授权项目', lastActiveAt: '2026-11-23T00:00:00Z' },
]

function show(onOpenArtifact = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CreateDesignDialog
        projects={projects}
        open
        hub={false}
        onClose={() => undefined}
        onOpenArtifact={onOpenArtifact}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('未连接项目保留需求草稿；只有选中的已授权项目会接收，回复不能冒充首次发布', async () => {
  const message = '给预约项目加确认表单'
  const session: AgentConversation = {
    id: 'f26865c7-30a2-402e-a834-2f20e7863606',
    harness: 'codex',
    projectId: 'p-alpha',
    turns: [
      {
        id: '9306209e-df23-485e-9943-2c32fc15c63e',
        message,
        status: 'complete',
        reply: '已准备设计。',
        publications: [],
      },
    ],
  }
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    switch (String(input)) {
      case '/api/v1/agent/connections':
        return Response.json({
          connections: [{ projectId: 'p-alpha', harness: 'codex', availability: 'ready' }],
        })
      case '/api/v1/agent/design':
        sent.push(JSON.parse(String(init?.body)))
        return Response.json(session, { status: 202 })
      case `/api/v1/agent/sessions/${session.id}`:
        return Response.json(session)
      default:
        return new Response(null, { status: 404 })
    }
  })
  const open = vi.fn()
  const form = show(open)
  fireEvent.change(screen.getByRole('combobox', { name: '项目' }), { target: { value: 'p-beta' } })
  fireEvent.change(screen.getByRole('textbox', { name: '设计需求' }), {
    target: { value: message },
  })
  await screen.findByText('该项目没有已连接的 Codex。')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送设计需求' }).disabled).toBe(
    true,
  )
  form.unmount()

  show(open)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '设计需求' }).value).toBe(message)
  fireEvent.change(screen.getByRole('combobox', { name: '项目' }), { target: { value: 'p-alpha' } })
  await screen.findByRole('option', { name: '本机 Codex' })
  fireEvent.change(screen.getByRole('combobox', { name: '发布 Agent' }), {
    target: { value: 'codex' },
  })
  fireEvent.click(screen.getByRole('button', { name: '发送设计需求' }))
  await screen.findByText('会话已结束，Agent 没有发布制品')
  expect(sent).toEqual([{ projectId: 'p-alpha', message }])
  expect(screen.queryByRole('button', { name: '打开已发布设计' })).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '设计需求' }).value).toBe(message)
})

it('收到受理响应前关闭并重开，继续跟踪同一个会话且不重复提交', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const message = '慢响应的预约表单'
  const session: AgentConversation = {
    id: '9197d9c2-57fc-45e6-ae9a-0c725c232dcd',
    projectId: 'p-alpha',
    harness: 'codex',
    turns: [
      { id: '78f5696a-28a7-4edf-9730-a548c9da5d4f', message, status: 'running', publications: [] },
    ],
  }
  let finish: (value: Response) => void = () => {
    throw new Error('缺少待受理请求')
  }
  const pending = new Promise<Response>((resolve) => {
    finish = resolve
  })
  const requests: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input), 'http://localhost').pathname
    requests.push(path)
    switch (path) {
      case '/api/v1/projects':
        return Response.json({ projects })
      case '/api/v1/artifacts':
        return Response.json({ artifacts: [] })
      case '/api/v1/favorites':
        return Response.json({ artifactIds: [] })
      case '/api/v1/agent/connections':
        return Response.json({
          connections: [{ projectId: 'p-alpha', harness: 'codex', availability: 'ready' }],
        })
      case '/api/v1/agent/design':
        return pending
      case `/api/v1/agent/sessions/${session.id}`:
        return Response.json(session)
      default:
        return new Response(null, { status: 404 })
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <LibraryShell onOpenArtifact={vi.fn()} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: '新建设计' }))
  await screen.findByRole('option', { name: '预约项目' })
  fireEvent.change(screen.getByRole('combobox', { name: '项目' }), { target: { value: 'p-alpha' } })
  await screen.findByRole('option', { name: '本机 Codex' })
  fireEvent.change(screen.getByRole('combobox', { name: '发布 Agent' }), {
    target: { value: 'codex' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: '设计需求' }), {
    target: { value: message },
  })
  fireEvent.click(screen.getByRole('button', { name: '发送设计需求' }))
  await waitFor(() => expect(requests).toContain('/api/v1/agent/design'))

  const dialog = screen.getByRole('dialog', { name: '新建设计' })
  const close = within(dialog).getAllByRole('button', { name: '关闭' }).at(-1)
  if (!close) throw new Error('未找到关闭按钮')
  fireEvent.click(close)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建设计' })).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '新建设计' }))
  await screen.findByRole('dialog', { name: '新建设计' })
  act(() => finish(Response.json(session, { status: 202 })))
  await screen.findByText('已交付本机 Codex，等待首次发布')
  await waitFor(() => expect(requests).toContain(`/api/v1/agent/sessions/${session.id}`))
  expect(requests.filter((path) => path === '/api/v1/agent/design')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '打开已发布设计' })).toBeNull()
})

it('失效记录须明确清除，不重发草稿；可打开已确认首发且回执已滚出的会话', async () => {
  const expired = '8b519967-1cd9-41cd-adea-4ce498161945'
  const message = '保留的预约需求'
  sessionStorage.setItem(
    'akasha:agent-design-attempt',
    JSON.stringify({ id: expired, projectId: 'p-alpha' }),
  )
  const current: AgentConversation = {
    id: 'ff8303ec-a2eb-4dcc-a24b-3c3e42838518',
    projectId: 'p-alpha',
    harness: 'codex',
    artifactId: 'FirstPublishedArtifact1',
    turns: [
      {
        id: '225d384b-deab-4b49-9ef7-ab708a907f3e',
        message: '后续对话',
        status: 'complete',
        reply: '已核对。',
        publications: [],
      },
    ],
  }
  const sends: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    switch (String(input)) {
      case '/api/v1/agent/connections':
        return Response.json({
          connections: [{ projectId: 'p-alpha', harness: 'codex', availability: 'ready' }],
        })
      case '/api/v1/agent/design':
        sends.push(JSON.parse(String(init?.body)))
        return Response.json(current, { status: 202 })
      case `/api/v1/agent/sessions/${current.id}`:
        return Response.json(current)
      default:
        return new Response(null, { status: 404 })
    }
  })
  const open = vi.fn()
  show(open)
  const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '设计需求' })
  fireEvent.change(editor, { target: { value: message } })
  fireEvent.click(await screen.findByRole('button', { name: '保留草稿，重新选择' }))
  expect(editor.value).toBe(message)
  expect(sends).toEqual([])
  fireEvent.change(screen.getByRole('combobox', { name: '发布 Agent' }), {
    target: { value: 'codex' },
  })
  fireEvent.click(screen.getByRole('button', { name: '发送设计需求' }))
  fireEvent.click(await screen.findByRole('button', { name: '打开已发布设计' }))
  expect(sends).toEqual([{ projectId: 'p-alpha', message }])
  expect(open).toHaveBeenCalledWith('FirstPublishedArtifact1')
})
