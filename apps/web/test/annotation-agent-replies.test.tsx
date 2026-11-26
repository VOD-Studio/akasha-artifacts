// @vitest-environment jsdom
import type { AnnotationThread, Feedback } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSelectionStore } from '../src/entities/selection'
import { useWorkspaceStore } from '../src/entities/workspace'
import { ArtifactReviewPanel } from '../src/features/review'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import {
  artifact,
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

function sourceWithHeadline() {
  return JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            designLayers: [
              {
                id: 'headline',
                kind: 'text',
                x: 40,
                y: 60,
                width: 240,
                height: 48,
                text: '核心标题',
                color: '#202733',
              },
            ],
          }
        : board,
    ),
  })
}

function selectHeadlineLayer() {
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'v1:headline',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'headline',
        label: '核心标题',
        width: 240,
        height: 48,
      },
    ],
  })
  return frame
}

it('从选区浮栏直接打开带锚点的批注输入，不强制展开全部讨论，并支持同对象双线程', async () => {
  stubResizeObserver()
  const submitted: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input).includes('/feedback') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        submitted.push(body)
        return Response.json(
          {
            feedback: {
              id: `fb_${submitted.length}`,
              artifactId: artifact.publicId,
              version: 1,
              roundId: body.roundId ?? null,
              groupId: null,
              kind: body.kind,
              audience: body.audience,
              element: body.element,
              body: body.body,
              author: 'human:local',
              draft: false,
              status: 'pending',
              createdAt: '2026-11-26T00:00:00Z',
              updatedAt: '2026-11-26T00:00:00Z',
            },
          },
          { status: 201 },
        )
      }
      return Response.json({ selection: null })
    }),
  )

  showWorkspace(detailFor(1, sourceWithHeadline()))
  selectHeadlineLayer()

  // 点击选区工具栏的「批注」直接弹出带锚点输入，不展开全部讨论抽屉。
  const toolbar = screen.getByTestId('selection-toolbar')
  fireEvent.click(within(toolbar).getByRole('button', { name: '批注' }))

  const popover = screen.getByTestId('anchored-annotation-composer')
  expect(screen.queryByRole('dialog', { name: '批注与评审' })).toBeNull()
  expect(screen.getByTestId('canvas-layer-focus')).toBeTruthy()
  expect(popover.textContent).toContain('核心标题')

  // 默认未勾选「同时发送给 Agent」——线程 1 仅给同事讨论。
  const sendToAgent = within(popover).getByRole('checkbox', { name: '同时发送给 Agent' })
  expect(sendToAgent.getAttribute('aria-checked')).toBe('false')
  fireEvent.change(within(popover).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '请同事确认下这段行距' },
  })
  fireEvent.click(within(popover).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(submitted).toHaveLength(1))
  expect(screen.queryByTestId('anchored-annotation-composer')).toBeNull()
  expect(submitted[0]).toMatchObject({
    kind: 'comment',
    audience: 'human',
    body: '请同事确认下这段行距',
    element: { boardId: 'desktop', blockId: 'design-layer:headline' },
  })

  // 同一对象仍在画面内且保持选中，再次打开撰写线程 2 并明确勾选发给 Agent。
  fireEvent.click(
    within(screen.getByTestId('selection-toolbar')).getByRole('button', { name: '批注' }),
  )
  const second = screen.getByTestId('anchored-annotation-composer')
  const secondCheckbox = within(second).getByRole('checkbox', { name: '同时发送给 Agent' })
  expect(secondCheckbox.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(secondCheckbox)
  expect(secondCheckbox.getAttribute('aria-checked')).toBe('true')
  fireEvent.change(within(second).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '把标题调粗并发布新版' },
  })
  fireEvent.click(within(second).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(submitted).toHaveLength(2))
  expect(submitted[1]).toMatchObject({
    kind: 'comment',
    audience: 'agent',
    body: '把标题调粗并发布新版',
    element: { boardId: 'desktop', blockId: 'design-layer:headline' },
  })
})

it('受邀批注访客不显示投递给本机 Agent 选项，且评审草拟轮次保存为本轮草稿', async () => {
  stubResizeObserver()
  const submitted: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input).includes('/feedback') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        submitted.push(body)
        return Response.json(
          {
            feedback: {
              id: `fb_${submitted.length}`,
              artifactId: artifact.publicId,
              version: 1,
              roundId: body.roundId ?? null,
              groupId: null,
              kind: 'comment',
              audience: body.audience,
              element: body.element,
              body: body.body,
              author: 'human:share',
              draft: Boolean(body.roundId),
              status: 'pending',
              createdAt: '2026-11-26T00:00:00Z',
              updatedAt: '2026-11-26T00:00:00Z',
            },
          },
          { status: 201 },
        )
      }
      return Response.json({ selection: null })
    }),
  )

  const view = showWorkspace({
    ...detailFor(1, sourceWithHeadline()),
    access: { role: 'comment', expiresAt: '2099-01-01T00:00:00.000Z' },
  })
  selectHeadlineLayer()
  fireEvent.click(
    within(screen.getByTestId('selection-toolbar')).getByRole('button', { name: '批注' }),
  )
  const guestComposer = screen.getByTestId('anchored-annotation-composer')
  expect(within(guestComposer).queryByRole('checkbox')).toBeNull()
  fireEvent.change(within(guestComposer).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '访客意见' },
  })
  fireEvent.click(within(guestComposer).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(submitted).toHaveLength(1))
  expect(submitted[0]?.audience).toBe('human')

  // 切换到作者 + 草拟评审轮次：浮层标明本轮草稿并提交带 roundId 的草稿。
  view.update(
    <ArtifactWorkspace
      detail={{
        ...detailFor(1, sourceWithHeadline()),
        rounds: [
          {
            id: 'round-1',
            artifactId: artifact.publicId,
            status: 'drafting',
            groups: [{ id: 'g1', title: '视觉验收', kind: 'verify' }],
            submittedAt: null,
            createdAt: '2026-11-26T00:00:00Z',
          },
        ],
      }}
      versions={[detailFor(1, sourceWithHeadline()).version]}
      sandboxOrigin="http://127.0.0.1:24331"
    />,
  )
  fireEvent.click(
    within(screen.getByTestId('selection-toolbar')).getByRole('button', { name: '批注' }),
  )
  const draftComposer = screen.getByTestId('anchored-annotation-composer')
  expect(draftComposer.textContent).toContain('本轮草稿')
  fireEvent.click(within(draftComposer).getByRole('checkbox', { name: '随本轮发给 Agent' }))
  fireEvent.change(within(draftComposer).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '等提交本轮再发给 Agent' },
  })
  fireEvent.click(within(draftComposer).getByRole('button', { name: '保存草稿' }))
  await waitFor(() => expect(submitted).toHaveLength(2))
  expect(submitted[1]).toMatchObject({ roundId: 'round-1', audience: 'agent' })
})

it('原线程清晰区分仅讨论、纯收件回执、排队、失败、仅回复无新版本与已发布版本并支持跳转', () => {
  stubResizeObserver()
  useWorkspaceStore.getState().setInspectorTab('review')
  const openVersion = vi.fn()
  const base = {
    artifactId: artifact.publicId,
    version: 1,
    roundId: null,
    groupId: null,
    kind: 'comment' as const,
    element: { boardId: 'desktop', blockId: 'design-layer:headline', textPreview: '核心标题' },
    author: 'human:local' as const,
    draft: false,
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  }
  const feedbacks: Feedback[] = [
    { ...base, id: 'fb-human', audience: 'human', status: 'pending', body: '仅同事讨论' },
    { ...base, id: 'fb-receipt', audience: 'agent', status: 'delivered', body: '纯 MCP 收件' },
    { ...base, id: 'fb-queued', audience: 'agent', status: 'pending', body: '排队中的请求' },
    { ...base, id: 'fb-failed', audience: 'agent', status: 'pending', body: '执行失败的请求' },
    { ...base, id: 'fb-reply', audience: 'agent', status: 'resolved', body: '仅文字回复的请求' },
    { ...base, id: 'fb-pub', audience: 'agent', status: 'resolved', body: '发布新版本的请求' },
  ]
  const threads: Record<string, AnnotationThread> = {
    'fb-queued': {
      replies: [],
      resolution: null,
      agent: { state: 'queued', publications: [], updatedAt: base.updatedAt },
    },
    'fb-failed': {
      replies: [],
      resolution: null,
      agent: {
        state: 'failed',
        error: 'Codex 未连接，请在本机运行 akasha agent connect',
        publications: [],
        updatedAt: base.updatedAt,
      },
    },
    'fb-reply': {
      replies: [],
      resolution: null,
      agent: {
        state: 'replied',
        reply: '字号符合规范，本次无需修改。',
        publications: [],
        updatedAt: base.updatedAt,
      },
    },
    'fb-pub': {
      replies: [],
      resolution: null,
      agent: {
        state: 'published',
        reply: '已提高标题对比度并发布 v2。',
        publications: [{ artifactId: artifact.publicId, version: 2 }],
        updatedAt: base.updatedAt,
      },
    },
  }

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ArtifactReviewPanel
        artifactId={artifact.publicId}
        projectId={artifact.projectId}
        activeVersion={1}
        activeRound={null}
        feedbacks={feedbacks}
        threads={threads}
        onOpenVersion={openVersion}
      />
    </QueryClientProvider>,
  )

  expect(screen.getByTestId('feedback-item-fb-human').textContent).toContain('仅讨论')
  expect(screen.queryByTestId('feedback-agent-fb-human')).toBeNull()

  const receiptCard = screen.getByTestId('feedback-item-fb-receipt')
  expect(receiptCard.textContent).toContain('已收件（尚无回复）')
  expect(receiptCard.textContent).toContain('仅收到 Agent 收件回执，尚未返回正文回复。')

  const queuedCard = screen.getByTestId('feedback-item-fb-queued')
  expect(queuedCard.textContent).toContain('排队中')
  expect(queuedCard.textContent).toContain('已排队等待上一轮完成后执行')

  const failedCard = screen.getByTestId('feedback-item-fb-failed')
  expect(failedCard.textContent).toContain('执行失败')
  expect(within(failedCard).getByRole('alert').textContent).toContain('Codex 未连接')

  const replyCard = screen.getByTestId('feedback-item-fb-reply')
  expect(replyCard.textContent).toContain('已回复 · 无新版本')
  expect(replyCard.textContent).toContain('字号符合规范，本次无需修改。')
  expect(replyCard.textContent).toContain('本轮仅回复，未发布新版本。')
  expect(within(replyCard).queryByRole('link')).toBeNull()

  const pubCard = screen.getByTestId('feedback-item-fb-pub')
  expect(pubCard.textContent).toContain('已发布新版本')
  expect(pubCard.textContent).toContain('已提高标题对比度并发布 v2。')
  const openLink = within(pubCard).getByRole('link', { name: '在 v2 查看该对象' })
  fireEvent.click(openLink)
  expect(openVersion).toHaveBeenCalledWith(2, 'board=desktop&thread=fb-pub&locate=1')
})

it('打开已发布版本可定位该对象，回看旧快照仍定位原对象', () => {
  stubResizeObserver()
  const fb: Feedback = {
    id: 'fb-v1',
    artifactId: artifact.publicId,
    version: 1,
    roundId: null,
    groupId: null,
    kind: 'comment',
    audience: 'agent',
    element: { boardId: 'desktop', blockId: 'design-layer:headline', textPreview: '核心标题' },
    body: '调整标题',
    author: 'human:local',
    draft: false,
    status: 'resolved',
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  }

  // 1. 打开 v2 并携带 locate=1：定位并高亮新版本上的同一对象。
  const detailV2 = detailFor(2, sourceWithHeadline())
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ArtifactWorkspace
        detail={detailV2}
        versions={[detailFor(1, sourceWithHeadline()).version, detailV2.version]}
        feedbacks={[fb]}
        sandboxOrigin="http://127.0.0.1:24331"
        address="#board=desktop&thread=fb-v1&locate=1"
      />
    </QueryClientProvider>,
  )
  const frameV2 = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frameV2.receive({ type: 'ready' })
  expect(useSelectionStore.getState().focusedFeedbackId).toBe('fb-v1')
  expect(useSelectionStore.getState().selectedByArtifact[artifact.publicId]).toEqual(fb.element)
  expect(
    frameV2.post.mock.calls.some(
      ([payload]) =>
        (payload as { type?: string; element?: { blockId?: string } }).type === 'highlight' &&
        (payload as { element?: { blockId?: string } }).element?.blockId ===
          'design-layer:headline',
    ),
  ).toBe(true)

  // 2. 回看旧快照 v1（#board=desktop&thread=fb-v1）：依然定位并高亮 v1 原对象。
  const detailV1 = detailFor(1, sourceWithHeadline())
  act(() => useSelectionStore.getState().clearSelection(artifact.publicId))
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ArtifactWorkspace
        detail={detailV1}
        versions={[detailV1.version, detailV2.version]}
        feedbacks={[fb]}
        fixedVersion={1}
        sandboxOrigin="http://127.0.0.1:24331"
        address="#board=desktop&thread=fb-v1"
      />
    </QueryClientProvider>,
  )
  const frameV1 = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frameV1.receive({ type: 'ready' })
  expect(useSelectionStore.getState().selectedByArtifact[artifact.publicId]).toEqual(fb.element)
  expect(
    frameV1.post.mock.calls.some(
      ([payload]) =>
        (payload as { type?: string; element?: { blockId?: string } }).type === 'highlight' &&
        (payload as { element?: { blockId?: string } }).element?.blockId ===
          'design-layer:headline',
    ),
  ).toBe(true)
})

it('头版本热更新时保留选区旁批注草稿正文与发送给 Agent 勾选状态', () => {
  stubResizeObserver()
  const openVersion = vi.fn()
  const detailV1 = detailFor(1, sourceWithHeadline())
  const detailV2 = detailFor(2, sourceWithHeadline())
  const view = showWorkspace(detailV1)
  view.update(
    <ArtifactWorkspace
      detail={detailV1}
      versions={[detailV1.version]}
      sandboxOrigin="http://127.0.0.1:24331"
      onOpenVersion={openVersion}
    />,
  )
  selectHeadlineLayer()

  fireEvent.click(
    within(screen.getByTestId('selection-toolbar')).getByRole('button', { name: '批注' }),
  )
  const popover = screen.getByTestId('anchored-annotation-composer')
  fireEvent.click(within(popover).getByRole('checkbox', { name: '同时发送给 Agent' }))
  fireEvent.change(within(popover).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '热更新前未写完的选区批注' },
  })

  // Agent 推送 v2 热更新：浮层不得卸载或丢失未提交草稿。
  view.update(
    <ArtifactWorkspace
      detail={detailV2}
      versions={[detailV1.version, detailV2.version]}
      sandboxOrigin="http://127.0.0.1:24331"
      onOpenVersion={openVersion}
    />,
  )
  const kept = screen.getByTestId('anchored-annotation-composer')
  const textarea = within(kept).getByRole('textbox', { name: '批注内容' }) as HTMLTextAreaElement
  expect(textarea.value).toBe('热更新前未写完的选区批注')
  expect(textarea.hasAttribute('readonly')).toBe(true)
  expect(
    within(kept).getByRole('checkbox', { name: '同时发送给 Agent' }).getAttribute('aria-checked'),
  ).toBe('true')
  fireEvent.click(within(kept).getByRole('link', { name: '回 v1 继续' }))
  expect(openVersion).toHaveBeenCalledWith(1)
})

it('批注抽屉已打开时，选区浮层与抽屉共享同一草稿源，编辑和提交后实时同步无残留', async () => {
  stubResizeObserver()
  const submitted: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input).includes('/feedback') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        submitted.push(body)
        return Response.json(
          {
            feedback: {
              id: `fb_sync_${submitted.length}`,
              artifactId: artifact.publicId,
              version: 1,
              roundId: null,
              groupId: null,
              kind: body.kind,
              audience: body.audience,
              element: body.element,
              body: body.body,
              author: 'human:local',
              draft: false,
              status: 'pending',
              createdAt: '2026-11-26T00:00:00Z',
              updatedAt: '2026-11-26T00:00:00Z',
            },
          },
          { status: 201 },
        )
      }
      return Response.json({ selection: null })
    }),
  )

  useWorkspaceStore.getState().setInspectorTab('review')
  showWorkspace(detailFor(1, sourceWithHeadline()))
  selectHeadlineLayer()

  // 右侧抽屉已处于打开状态，再从选区工具栏打开带锚点的批注浮层（两者同时挂载）。
  const drawer = screen.getByRole('dialog', { name: '批注与评审' })
  const drawerTextarea = within(drawer).getByRole('textbox', {
    name: '批注内容',
  }) as HTMLTextAreaElement
  fireEvent.click(
    within(screen.getByTestId('selection-toolbar')).getByRole('button', { name: '批注' }),
  )
  const popover = screen.getByTestId('anchored-annotation-composer')

  // 在选区浮层编辑正文与投递勾选，抽屉中的编辑器立即同步，不保留过期副本。
  fireEvent.change(within(popover).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '同步验证草稿正文' },
  })
  fireEvent.click(within(popover).getByRole('checkbox', { name: '同时发送给 Agent' }))
  expect(drawerTextarea.value).toBe('同步验证草稿正文')
  expect(
    within(drawer).getByRole('checkbox', { name: '同时发送给 Agent' }).getAttribute('aria-checked'),
  ).toBe('true')

  // 从选区浮层提交后，抽屉编辑器同步清空正文与勾选状态，防止重复提交。
  fireEvent.click(within(popover).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(submitted).toHaveLength(1))
  expect(screen.queryByTestId('anchored-annotation-composer')).toBeNull()
  expect(drawerTextarea.value).toBe('')
  expect(
    within(drawer).getByRole('checkbox', { name: '同时发送给 Agent' }).getAttribute('aria-checked'),
  ).toBe('false')
})
