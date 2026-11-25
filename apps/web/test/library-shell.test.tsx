// @vitest-environment jsdom
import type { Artifact } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact'
import { projectKeys } from '../src/entities/project'
import { useWorkspaceStore } from '../src/entities/workspace'
import { LibraryShell } from '../src/widgets/LibraryShell'
import { useLibraryView } from '../src/widgets/LibraryShell/model/library-view'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

const SAMPLE_ARTIFACT: Artifact = {
  publicId: 'AbCdEfGhIjKlMnOpQrStU',
  slug: 'demo/live-card',
  projectId: 'proj_1',
  title: '实时状态卡片',
  type: 'html',
  visibility: 'private',
  headVersion: 1,
  createdAt: '2026-11-22T09:00:00.000Z',
  updatedAt: '2026-11-22T09:00:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  sessionStorage.clear()
  useLibraryView.setState(useLibraryView.getInitialState())
  useWorkspaceStore.setState({ selectedProjectId: null })
})

it('制品库快捷键聚焦同一搜索框，打开制品再返回保留关键词与滚动位置', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  })
  queryClient.setQueryData(projectKeys.all, [
    {
      id: 'proj_1',
      rootPath: '/repo/alpha',
      name: 'Alpha Repo',
      lastActiveAt: '2026-11-22T09:00:00.000Z',
      dormant: false,
    },
    {
      id: 'proj_old',
      rootPath: '/repo/legacy',
      name: 'Legacy Repo',
      lastActiveAt: '2026-10-01T00:00:00.000Z',
      dormant: true,
    },
  ])
  queryClient.setQueryData(artifactKeys.list(undefined), [
    SAMPLE_ARTIFACT,
    {
      ...SAMPLE_ARTIFACT,
      publicId: 'LegacyLibraryItemAbC123',
      projectId: 'proj_old',
      title: '旧任务参考',
      type: 'markdown',
    },
  ])

  const opened: string[] = []
  const openLibrary = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <LibraryShell onOpenArtifact={(id) => opened.push(id)} />
      </QueryClientProvider>,
    )

  const library = openLibrary()
  expect(screen.getByRole('link', { name: '旧任务参考' }).getAttribute('href')).toBe(
    '/a/LegacyLibraryItemAbC123',
  )
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const search = screen.getByRole('searchbox', { name: '搜索作品' })
  expect(document.activeElement).toBe(search)
  fireEvent.change(search, { target: { value: '状态' } })
  expect(screen.queryByText('旧任务参考')).toBeNull()
  const scroller = screen.getByRole('region', { name: '作品列表' })
  scroller.scrollTop = 80
  fireEvent.scroll(scroller)

  fireEvent.click(screen.getByText('实时状态卡片'))
  expect(opened).toEqual([SAMPLE_ARTIFACT.publicId])
  library.unmount()
  openLibrary()
  expect(screen.getByRole<HTMLInputElement>('searchbox', { name: '搜索作品' }).value).toBe('状态')
  expect(screen.getByRole('region', { name: '作品列表' }).scrollTop).toBe(80)
  expect(screen.queryByText('旧任务参考')).toBeNull()
})

it('Hub 项目库持续打开时会显示 Agent 新发布的项目和制品', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const project = {
    id: 'proj_review',
    rootPath: '/repo/review',
    name: '新登记项目',
    lastActiveAt: '2026-11-22T09:00:00.000Z',
    dormant: false,
  }
  let published = false
  vi.stubGlobal('fetch', async (url: string) => {
    switch (url) {
      case '/api/v1/projects':
        return Response.json({ projects: published ? [project] : [] })
      case '/api/v1/artifacts':
        return Response.json({
          artifacts: published
            ? [{ ...SAMPLE_ARTIFACT, projectId: project.id, title: '新发布制品' }]
            : [],
        })
      case '/api/v1/auth/session':
        return Response.json({ user: { login: 'reviewer', member: true } })
      default:
        throw new Error(`意外请求：${url}`)
    }
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  try {
    render(
      <QueryClientProvider client={queryClient}>
        <LibraryShell onOpenArtifact={() => {}} />
      </QueryClientProvider>,
    )
    await act(() => vi.advanceTimersByTimeAsync(20))
    expect(screen.queryByText('新发布制品')).toBeNull()
    expect(screen.queryByRole('button', { name: '新建设计' })).toBeNull()

    published = true
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(screen.getByText('新发布制品')).toBeTruthy()
    const projects = screen.getByRole('button', { name: '筛选项目' })
    fireEvent.keyDown(projects, { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: '新登记项目' }))
    expect(projects.textContent).toBe('新登记项目')
    expect(screen.getByText('新发布制品')).toBeTruthy()
  } finally {
    cleanup()
    queryClient.clear()
    vi.unstubAllGlobals()
  }
})
