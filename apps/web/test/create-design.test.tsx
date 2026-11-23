// @vitest-environment jsdom
import type { AgentConversation, Project } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CreateDesignDialog } from '../src/widgets/LibraryShell/CreateDesignDialog'

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
