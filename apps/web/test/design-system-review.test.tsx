// @vitest-environment jsdom
import { type DesignSystemDraft, PROTOCOL_VERSION } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemEditor } from '../src/features/design-system/ui/SystemEditor'
import { setLocale } from '../src/shared/i18n'

const base: DesignSystemDraft = {
  origin: { kind: 'github-checkout', label: 'team/controls' },
  files: [
    { kind: 'source', path: 'Button.tsx', content: 'export default () => <button>red</button>' },
    { kind: 'guidelines', path: 'tone.md', content: 'Short sentences' },
    { kind: 'guidelines', path: 'layout.md', content: 'Keep gutters' },
    {
      kind: 'figma',
      path: 'references/checkout.url',
      content: 'https://www.figma.com/design/checkout/App',
    },
  ],
  components: [{ path: 'Button.tsx', exportName: 'default', props: { children: 'Continue' } }],
  guidance: {
    fontFamily: 'Brand Sans',
    color: '#b11',
    spacing: 20,
    instructions: 'Use for checkout',
  },
}

const preview = {
  sourceVersion: 'a'.repeat(64),
  reviewToken: 'b'.repeat(64),
  previewSource: 'export default () => <button>blue</button>',
}
const id = 'DesignSystemReview1234'
const buildButton = '允许构建并预览所选组件'

function review() {
  const saved = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SystemEditor
        projectId="team"
        sandboxOrigin="http://sandbox.test"
        baseline={{ id, version: 1, title: 'Team', slug: 'system/team', draft: base }}
        onSaved={saved}
      />
    </QueryClientProvider>,
  )
  return saved
}

async function openedSandbox(title: string) {
  const frame = await screen.findByTitle<HTMLIFrameElement>(title)
  // 桥先订阅消息，再带 nonce 导航；iframe 出现在 DOM 不代表沙盒会话已经建立。
  await waitFor(() => {
    expect(frame.getAttribute('src')).toMatch(/^http:\/\/sandbox\.test\/#/)
    expect(new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')).toMatch(
      /^[a-f0-9]{32}$/,
    )
  })
  return frame
}

function report(frame: HTMLIFrameElement, payload: Record<string, unknown>) {
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'null',
      data: { v: PROTOCOL_VERSION, nonce, ...payload },
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setLocale('zh-CN')
})

it('重选只读取勾选的文件，区分变更和缺失；逐项决定后才允许构建，失败不丢说明或假发布', async () => {
  const submitted: Array<{ path: string; body: Record<string, unknown> }> = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    submitted.push({ path: String(input), body: JSON.parse(String(init?.body)) })
    if (String(input).endsWith('/preview')) return Response.json(preview)
    return Response.json(
      { error: { code: 'VERSION_CONFLICT', message: '基准版本已变化' } },
      { status: 409 },
    )
  })
  const saved = review()
  const next = new File(['export default () => <button>blue</button>'], 'Button.tsx')
  const omitted = new File(['do not import'], 'private.txt')
  fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [next, omitted] } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'private.txt' }))
  fireEvent.click(screen.getByRole('button', { name: '用所选文件重新同步' }))
  await screen.findByText('已变更')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: buildButton }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: '确认移除 file:tone.md' }))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: buildButton }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '保留旧项 file:layout.md' }))
  expect(submitted).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: buildButton }))
  const frame = await openedSandbox('隔离预览')
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '保存系统版本' })
  expect(save.disabled).toBe(true)
  report(frame, { type: 'ready' })
  report(frame, { type: 'rendered', version: 1 })
  await waitFor(() => expect(save.disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByRole('alert')
  const files = [
    base.files[3],
    { ...base.files[0], content: 'export default () => <button>blue</button>' },
    base.files[2],
  ]
  expect(submitted[0]).toEqual({
    path: '/api/v1/projects/team/design-systems/preview',
    body: { buildApproved: true, draft: { ...base, files } },
  })
  expect(submitted[1]?.body).toMatchObject({
    id,
    baseVersion: 1,
    confirmedRemovals: ['file:tone.md'],
    reviewToken: preview.reviewToken,
  })
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '使用说明' }).value).toBe(
    base.guidance.instructions,
  )
  expect(saved).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: '颜色' }), { target: { value: '#027' } })
  expect(save.disabled).toBe(true)
  expect(screen.queryByTitle('隔离预览')).toBeNull()
})

it('沙盒的运行时错误不计作成功预览，不能发布', async () => {
  setLocale('en')
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(preview))
  review()
  fireEvent.click(
    screen.getByRole('button', { name: 'Allow build and preview selected components' }),
  )
  const frame = await openedSandbox('Isolated preview')
  report(frame, { type: 'ready' })
  report(frame, { type: 'error', phase: 'runtime', message: 'Button failed to mount' })
  await screen.findByText('Button failed to mount')
  report(frame, { type: 'rendered', version: 1 })
  const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save system version' })
  expect(save.disabled).toBe(true)
  fireEvent.click(save)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
