// @vitest-environment jsdom
import type { Artifact, Version, VersionSummary } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { BoardTweakApplyDialog } from '../src/widgets/ArtifactWorkspace/inspector/BoardTweakApplyDialog'

const now = '2026-11-25T10:00:00.000Z'
const artifact: Artifact = {
  publicId: 'TweakApplication0000001',
  projectId: 'design',
  slug: 'design/flow',
  title: 'Flow',
  type: 'artboard',
  visibility: 'private',
  headVersion: 3,
  createdAt: now,
  updatedAt: now,
}
const field = { id: 'speed', type: 'number', label: 'Speed', min: 0, max: 10, default: 2 }
const base: Version = {
  artifactId: artifact.publicId,
  title: artifact.title,
  version: 3,
  parentVersion: 2,
  createdAt: now,
  author: 'agent:cli',
  source: JSON.stringify({
    boards: [
      { id: 'first', title: 'Cover', tweaks: [field] },
      { id: 'other', title: 'Cover', tweaks: [field] },
      { id: 'same', title: 'Done', tweaks: [{ ...field, default: 4 }] },
      { id: 'narrow', title: 'Narrow', tweaks: [{ ...field, max: 3 }] },
    ],
  }),
}

function openDialog(agentAllowed = false, version: VersionSummary = base) {
  const onApplied = vi.fn()
  const onClose = vi.fn()
  const onAgentAccepted = vi.fn()
  const onApply = vi.fn(
    async (_source: string, _base: VersionSummary, _saved: (v: Version) => void) => true,
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <BoardTweakApplyDialog
        artifact={artifact}
        base={version}
        boardId="first"
        values={{ speed: 4 }}
        agentAllowed={agentAllowed}
        onApply={onApply}
        onApplied={onApplied}
        onAgentAccepted={onAgentAccepted}
        onClose={onClose}
      />
    </QueryClientProvider>,
  )
  return { onApply, onApplied, onAgentAccepted, onClose }
}

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  vi.restoreAllMocks()
})

it('选择另一张同名画板后只修改该板；保存器受理不等于已发布', async () => {
  const request = vi.spyOn(window, 'fetch')
  const { onApply, onApplied, onClose } = openDialog()
  expect(screen.getByText('基准版本 v3')).toBeTruthy()
  const current = screen.getByRole('checkbox', { name: /Cover.*first/ })
  const other = screen.getByRole('checkbox', { name: /Cover.*other/ })
  expect(current.getAttribute('aria-checked')).toBe('true')
  expect(other.getAttribute('aria-checked')).toBe('false')
  expect(screen.getByRole('checkbox', { name: /Narrow/ })).toHaveProperty('disabled', true)
  expect(screen.getByRole('checkbox', { name: /Done/ })).toHaveProperty('disabled', true)
  fireEvent.click(current)
  const publish = screen.getByRole('button', { name: '发布新版本' })
  expect(publish).toHaveProperty('disabled', true)
  fireEvent.click(other)
  fireEvent.click(publish)
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  const [source, snapshot, saved] = onApply.mock.calls[0]
  expect(snapshot.version).toBe(3)
  expect(
    JSON.parse(source).boards.map((b: { tweaks: { default: number }[] }) => b.tweaks[0].default),
  ).toEqual([2, 4, 4, 2])
  expect(onApplied).not.toHaveBeenCalled()
  const receipt = { ...base, version: 4, parentVersion: 3, source }
  saved(receipt)
  expect(onApplied).toHaveBeenCalledWith(receipt, ['Cover (other)'])
  expect(request).not.toHaveBeenCalled()
})

it('英文工作台向已绑定会话发送所选范围；受理后只打开对话', async () => {
  setLocale('en')
  const session = {
    id: crypto.randomUUID(),
    projectId: artifact.projectId,
    artifactId: artifact.publicId,
    harness: 'codex',
    turns: [],
  }
  const turn = { id: crypto.randomUUID(), status: 'complete', message: 'Cover', publications: [] }
  const request = vi
    .spyOn(window, 'fetch')
    .mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? Response.json({ ...session, turns: [turn] }, { status: 202 })
        : Response.json({ availability: 'ready', session }),
    )
  const { onApplied, onApply, onAgentAccepted } = openDialog(true)
  fireEvent.click(screen.getByRole('checkbox', { name: /Cover.*other/ }))
  const agent = screen.getByRole('button', { name: 'Ask Agent to apply' })
  await waitFor(() => expect(agent).toHaveProperty('disabled', false))
  fireEvent.click(agent)
  await waitFor(() => expect(onAgentAccepted).toHaveBeenCalledOnce())
  const post = request.mock.calls.filter(([, init]) => init?.method === 'POST')
  expect(post).toHaveLength(1)
  expect(JSON.parse(String(post[0][1]?.body))).toMatchObject({
    target: {
      artifactId: artifact.publicId,
      projectId: artifact.projectId,
      boardId: 'first',
      version: 3,
    },
    tweakApplication: { boardId: 'first', targetIds: ['first', 'other'], values: { speed: 4 } },
  })
  expect(onApply).not.toHaveBeenCalled()
  expect(onApplied).not.toHaveBeenCalled()
})

it('无法读取固定版本时不提交，也不改读最新版', async () => {
  const request = vi.spyOn(window, 'fetch').mockResolvedValue(
    Response.json(
      {
        error: { code: 'FORBIDDEN', message: '没有读取权限' },
      },
      { status: 403 },
    ),
  )
  const { source: _source, ...summary } = base
  const { onApply, onApplied } = openDialog(false, summary)
  expect((await screen.findByRole('alert')).textContent).toContain('没有读取权限')
  expect(screen.getByRole('button', { name: '发布新版本' })).toHaveProperty('disabled', true)
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    `/api/v1/artifacts/${artifact.publicId}?version=3`,
  ])
  expect(onApply).not.toHaveBeenCalled()
  expect(onApplied).not.toHaveBeenCalled()
})

it('作品已更新时不允许发布旧基准版本', () => {
  const { onApply } = openDialog(false, { ...base, version: 2 })
  expect(screen.getByRole('alert').textContent).toContain('已基于 v2 打开，作品已更新')
  expect(screen.getByRole('button', { name: '发布新版本' })).toHaveProperty('disabled', true)
  expect(onApply).not.toHaveBeenCalled()
})

it('保存器未受理时保留确认窗与范围，不发布或自动重试', async () => {
  const { onApply, onApplied, onClose } = openDialog()
  onApply.mockResolvedValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: '发布新版本' }))
  expect((await screen.findByRole('alert')).textContent).toBe('无法应用参数')
  expect(screen.getByRole('checkbox', { name: /Cover.*first/ }).getAttribute('aria-checked')).toBe(
    'true',
  )
  expect(onApply).toHaveBeenCalledOnce()
  expect(onApplied).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})
