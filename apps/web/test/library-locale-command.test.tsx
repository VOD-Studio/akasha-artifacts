// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import { ArtifactCommandPalette } from '../src/features/command-palette'
import { setLocale } from '../src/shared/i18n'

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  useWorkspaceStore.getState().setCommandPaletteOpen(false)
  vi.unstubAllGlobals()
})

it('命令面板使用当前语言显示结果数与空态；输入、焦点和打开动作在换语言后仍可用', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/v1/projects') return Response.json({ projects: [] })
    if (url === '/api/v1/artifacts') return Response.json({ artifacts: [] })
    return new Response(null, { status: 404 })
  })
  setLocale('en')
  const navigate = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ArtifactCommandPalette onNavigate={navigate} />
    </QueryClientProvider>,
  )
  fireEvent.keyDown(window, { ctrlKey: true, key: 'k' })
  await screen.findByRole('dialog', { name: 'Command palette' })
  const query = screen.getByRole<HTMLInputElement>('combobox', {
    name: 'Search artifacts, projects, or actions…',
  })
  expect(screen.getByText('1 item')).toBeTruthy()
  fireEvent.change(query, { target: { value: 'missing-entry' } })
  expect(screen.getByText('No results found')).toBeTruthy()
  act(() => setLocale('ar'))
  expect(screen.getByText('لا توجد نتائج')).toBeTruthy()
  expect(document.activeElement).toBe(query)
  expect(query.value).toBe('missing-entry')
  fireEvent.change(query, { target: { value: 'home' } })
  expect(screen.getByText('عنصر واحد')).toBeTruthy()
  fireEvent.keyDown(query, { key: 'Enter' })
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
})
