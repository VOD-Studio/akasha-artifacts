// @vitest-environment jsdom
import type { Feedback } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '@/entities/workspace'
import { ArtifactReviewPanel } from '@/features/review'
import { setLocale } from '@/shared/i18n'

const comment: Feedback = {
  id: 'thread-a',
  artifactId: 'review-locale',
  version: 1,
  roundId: null,
  groupId: null,
  kind: 'comment',
  element: null,
  body: 'Keep «发送» unchanged.',
  author: 'Mona 张',
  draft: false,
  status: 'pending',
  createdAt: '2026-11-22T09:00:00Z',
  updatedAt: '2026-11-22T09:00:00Z',
}

function openReview(canComment: boolean) {
  useWorkspaceStore.getState().setInspectorTab('review')
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ArtifactReviewPanel
        artifactId={comment.artifactId}
        projectId="project"
        activeVersion={1}
        activeRound={{
          id: 'current-round',
          artifactId: comment.artifactId,
          status: 'submitted',
          submittedAt: comment.createdAt,
          createdAt: comment.createdAt,
          groups: [
            {
              id: 'group-a',
              title: 'Author’s review question',
              kind: 'choose',
              options: ['A', 'B'],
              choice: 'B',
            },
          ],
        }}
        feedbacks={[comment]}
        canComment={canComment}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.getState().setInspectorTab(null)
  setLocale('zh-CN')
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

it('切换阿拉伯语移动非模态抽屉，不替换回复焦点、草稿或作者正文', () => {
  setLocale('en')
  openReview(true)
  const english = screen.getByRole('dialog', { name: 'Comments and review' })
  expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Comment text' })).toBeTruthy()
  act(() => setLocale('de'))
  const drawer = screen.getByRole('dialog', { name: 'Kommentare und Review' })
  expect(drawer).toBe(english)
  expect(drawer.getAttribute('data-side')).toBe('right')
  fireEvent.click(screen.getByRole('button', { name: 'Antworten' }))
  const reply = screen.getByRole('textbox', { name: 'Antworttext' })
  reply.focus()
  fireEvent.change(reply, { target: { value: '草稿 · Antwort' } })
  act(() => setLocale('ar'))
  expect(screen.getByRole('dialog', { name: 'التعليقات والمراجعة' })).toBe(drawer)
  expect(drawer.getAttribute('data-side')).toBe('left')
  expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
  expect(screen.getByRole('textbox', { name: 'نص الرد' })).toBe(reply)
  expect(document.activeElement).toBe(reply)
  expect(screen.getByDisplayValue('草稿 · Antwort')).toBe(reply)
  expect(screen.getByText(comment.author)).toBeTruthy()
  expect(screen.getByText(comment.body)).toBeTruthy()
})

it('阿拉伯语只读评审可查看和筛选讨论，但不提供发送、回复、解决或批准', () => {
  setLocale('ar')
  openReview(false)
  expect(screen.getByText(comment.body)).toBeTruthy()
  expect(screen.getByText('Author’s review question')).toBeTruthy()
  expect(screen.getByText('B')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'B' })).toBeNull()
  expect(screen.getByRole('combobox', { name: 'حالة الحل' })).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  for (const name of ['إرسال', 'رد', 'تحديد كمحلول', 'الموافقة على v1']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
})

it('后台拒绝发送后保留可复制的草稿，不再提供发送动作', async () => {
  setLocale('de')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 403 })),
  )
  openReview(true)
  const composer = screen.getByRole('textbox', { name: 'Kommentartext' })
  fireEvent.change(composer, { target: { value: 'Nicht verlieren' } })
  fireEvent.click(screen.getByRole('button', { name: 'Senden' }))
  expect(await screen.findByText('Keine Berechtigung zum Kommentieren')).toBeTruthy()
  expect(screen.getByDisplayValue('Nicht verlieren')).toBe(composer)
  expect(composer.hasAttribute('readonly')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Senden' })).toBeNull()
})

it('英语评审抽屉先退出筛选列表，再退出抽屉', async () => {
  setLocale('en')
  openReview(false)
  const drawer = screen.getByRole('dialog', { name: 'Comments and review' })
  expect(drawer.getAttribute('aria-modal')).toBe('false')
  const filter = screen.getByRole('combobox', { name: 'Resolution status' })
  filter.focus()
  fireEvent.keyDown(filter, { key: 'ArrowDown' })
  expect(await screen.findByRole('listbox')).toBeTruthy()
  fireEvent.keyDown(filter, { key: 'Escape' })
  await vi.waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  expect(screen.getByRole('dialog', { name: 'Comments and review' })).toBe(drawer)
  await vi.waitFor(() => expect(document.activeElement).toBe(filter))
  fireEvent.keyDown(filter, { key: 'Escape' })
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
