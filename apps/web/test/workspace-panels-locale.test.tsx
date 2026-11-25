// @vitest-environment jsdom
import type { Artifact, Version } from '@akasha/protocol'
import { EditorView } from '@codemirror/view'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { AgentConversationPane } from '../src/features/agent-conversation'
import { SplitCodeEditor } from '../src/features/code-editor'
import { DaemonStatusPill } from '../src/features/daemon-control'
import { VersionDiffView } from '../src/features/version-diff'
import { setLocale } from '../src/shared/i18n'

const createdAt = '2026-11-22T12:00:00Z'
const artifact: Artifact = {
  publicId: 'Werk001',
  slug: 'design',
  projectId: 'atelier',
  title: '設計',
  type: 'html',
  headVersion: 8,
  visibility: 'private',
  createdAt,
  updatedAt: createdAt,
}
const version: Version = {
  artifactId: artifact.publicId,
  version: 8,
  parentVersion: 7,
  title: artifact.title,
  author: 'agent:cli',
  createdAt,
  source: '<p>設計</p>',
}

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  }
  Range.prototype.getClientRects ??= () => document.body.getClientRects()
  Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect()
})
afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  vi.restoreAllMocks()
})

it('代码编辑时切换语言保留焦点、未保存的文本、选区与版本号', () => {
  setLocale('de')
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <SplitCodeEditor artifact={artifact} version={version} />
    </QueryClientProvider>,
  )
  const field = screen.getByRole('textbox', { name: 'Code-Editor' })
  const view = EditorView.findFromDOM(field)
  if (!view) throw new Error('CodeMirror 未挂载')
  act(() => {
    view.focus()
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '<h1>عنوان</h1>' },
      selection: { anchor: 4, head: 9 },
    })
  })
  expect(screen.getByText('Ungespeichert')).toBeTruthy()
  act(() => setLocale('en'))
  expect(screen.getByText('Unsaved')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Code editor' }))
  act(() => setLocale('ar'))
  const translated = screen.getByRole('textbox', { name: 'محرر الشفرة' })
  expect(document.activeElement).toBe(translated)
  expect(translated.dir).toBe('ltr')
  expect(view.state.doc.toString()).toBe('<h1>عنوان</h1>')
  expect([view.state.selection.main.anchor, view.state.selection.main.head]).toEqual([4, 9])
  expect(screen.getByText('غير محفوظ')).toBeTruthy()
  expect(screen.getByText('v8')).toBeTruthy()
})

it('版本对比的复数与数字随语言更新，不反转源码或改写版本标识', () => {
  setLocale('de')
  const base: Version = { ...version, version: 7, parentVersion: 6, source: 'مرحبا' }
  const head: Version = { ...version, source: 'مرحبا\nconst x = 1\nconst y = 2' }
  render(<VersionDiffView versions={[base, head]} activeVersion={8} />)
  expect(screen.getByText('2 Zeilen hinzugefügt')).toBeTruthy()
  const select = screen.getByRole('combobox', { name: 'Ausgangsversion' })
  select.focus()
  act(() => setLocale('en'))
  expect(screen.getByRole('combobox', { name: 'Base version' })).toBe(select)
  expect(screen.getByText('2 lines added')).toBeTruthy()
  expect(screen.getByText('0 lines removed')).toBeTruthy()
  act(() => setLocale('ar'))
  expect(screen.getByRole('combobox', { name: 'الإصدار الأساسي' })).toBe(select)
  expect(document.activeElement).toBe(select)
  expect(select.textContent).toContain('v7')
  expect(screen.getByText('أُضيف سطران')).toBeTruthy()
  expect(screen.getByText('+٢')).toBeTruthy()
  expect(screen.getByText('لم تُحذف أي أسطر')).toBeTruthy()
  expect(screen.getByText('const x = 1').closest('table')?.dir).toBe('ltr')
})

it('断开 CLI 的会话切换语言不重发请求、不丢消息草稿，仅提供本机可执行命令', async () => {
  setLocale('de')
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ availability: 'offline' }))
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentConversationPane
        artifactId="work"
        projectId="atelier"
        open
        onClose={() => {}}
        onClearTarget={() => {}}
      />
    </QueryClientProvider>,
  )
  await screen.findByText('Codex im Projektverzeichnis verbinden')
  const draft = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Nachricht' })
  draft.focus()
  fireEvent.change(draft, { target: { value: 'مراجعة Design' } })
  draft.setSelectionRange(2, 5)
  act(() => setLocale('ar'))
  expect(screen.getByRole('textbox', { name: 'الرسالة' })).toBe(draft)
  expect(document.activeElement).toBe(draft)
  expect(draft.value).toBe('مراجعة Design')
  expect([draft.selectionStart, draft.selectionEnd]).toEqual([2, 5])
  expect(screen.getByText('akasha agent connect --project .').dir).toBe('ltr')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'إرسال' }).disabled).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('本地服务可响应但无权限时不给启动命令、停机或日志操作', async () => {
  setLocale('en')
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (String(input).endsWith('/api/v1/projects')) return Response.json({ projects: [] })
    return new Response(null, { status: 403 })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
  render(
    <QueryClientProvider client={client}>
      <DaemonStatusPill />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Local service status unavailable' }))
  expect(await screen.findByText('You do not have permission to perform this action.')).toBeTruthy()
  expect(screen.queryByText('akasha serve')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Stop service' })).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy()
})
