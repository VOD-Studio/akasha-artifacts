// @vitest-environment jsdom
import type { Artifact, Version } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace/store'
import { SplitCodeEditor } from '../src/features/code-editor/SplitCodeEditor'
import { ApiError } from '../src/shared/api/error'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace/ArtifactWorkspace'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  // CodeMirror 6 在 jsdom 测量光标位置时会读取 Range.getClientRects / getBoundingClientRect
  if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: function* () {},
      }) as unknown as DOMRectList
  }
  if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWorkspaceStore.setState({ viewMode: 'preview', inspectorTab: null })
})

const SAMPLE_ARTIFACT: Artifact = {
  publicId: 'EditArtifactPublicId1',
  slug: 'html/editor-demo',
  projectId: 'proj_edit',
  title: '编辑器演示',
  type: 'html',
  visibility: 'private',
  headVersion: 1,
  createdAt: '2026-11-22T12:00:00.000Z',
  updatedAt: '2026-11-22T12:00:00.000Z',
}

const V1: Version = {
  artifactId: SAMPLE_ARTIFACT.publicId,
  version: 1,
  parentVersion: null,
  author: 'agent:cli',
  title: '编辑器演示',
  source: '<h1>Hello v1</h1>',
  createdAt: '2026-11-22T12:00:00.000Z',
}

const V2_AGENT: Version = {
  artifactId: SAMPLE_ARTIFACT.publicId,
  version: 2,
  parentVersion: 1,
  author: 'agent:cli',
  title: '编辑器演示',
  source: '<h1>Hello v2 from agent</h1>',
  createdAt: '2026-11-22T12:02:00.000Z',
}

function editCodeMirrorText(container: HTMLElement, nextText: string) {
  const cmContent = container.querySelector('.cm-content') as HTMLElement | null
  expect(cmContent).toBeTruthy()
  if (!cmContent) return
  cmContent.textContent = nextText
  fireEvent.input(cmContent)
}

describe('apps/web L3 CodeMirror 6 分栏代码编辑与冲突处理', () => {
  it('支持实时预览回调、保存生成 human 版本并写入 kind=edit 反馈', async () => {
    const fetchCalls: Array<{ url: string; method?: string; body?: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const body = typeof init?.body === 'string' ? init.body : undefined
      fetchCalls.push({ url, method: init?.method, body })
      if (url.endsWith('/api/v1/artifacts')) {
        const payload = JSON.parse(body ?? '{}') as { source: string }
        return new Response(
          JSON.stringify({
            artifact: { ...SAMPLE_ARTIFACT, headVersion: 2 },
            version: {
              ...V1,
              version: 2,
              parentVersion: 1,
              author: 'human:web',
              source: payload.source,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ feedback: { id: 'fb_edit' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    })

    const previewUpdates: Array<string | null> = []
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor
          artifact={SAMPLE_ARTIFACT}
          version={V1}
          onLivePreviewChange={(src) => previewUpdates.push(src)}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('l3-code-editor')).toBeTruthy()
    expect(container.querySelector('.cm-editor')).toBeTruthy()

    act(() => {
      editCodeMirrorText(container, '<h1>Hello edited by human</h1>')
    })

    await waitFor(() => expect(previewUpdates).toContain('<h1>Hello edited by human</h1>'))
    expect(screen.getByText('未保存')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^保存/ }))

    await waitFor(() => {
      const saveCall = fetchCalls.find((c) => c.url.endsWith('/api/v1/artifacts'))
      expect(saveCall?.body).toContain('"author":"human:web"')
      expect(saveCall?.body).toContain('"baseVersion":1')
      const fbCall = fetchCalls.find((c) => c.url.includes('/feedback'))
      expect(fbCall?.body).toContain('"kind":"edit"')
    })
  })

  it('保存遇到 409 VERSION_CONFLICT 时展示双方差异横幅，并支持基于最新 headVersion 合并保存', async () => {
    const attempts: Array<{ baseVersion: number; source: string }> = []
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor
          artifact={SAMPLE_ARTIFACT}
          version={V1}
          onSaveOverride={async ({ source, baseVersion }) => {
            attempts.push({ source, baseVersion })
            if (baseVersion === 1) {
              throw new ApiError(409, 'VERSION_CONFLICT', '版本冲突', {
                artifactId: SAMPLE_ARTIFACT.publicId,
                baseVersion: 1,
                headVersion: 2,
                diff: '--- v1\n+++ v2\n-<h1>Hello v1</h1>\n+<h1>Hello v2 from agent</h1>',
                authors: ['agent:cli'],
              })
            }
            return {
              version: {
                ...V1,
                version: 3,
                parentVersion: 2,
                author: 'human:web',
                source,
              },
            }
          }}
        />
      </QueryClientProvider>,
    )

    act(() => {
      editCodeMirrorText(container, '<h1>Hello merged by human</h1>')
    })
    await waitFor(() => expect(screen.getByText('未保存')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /^保存/ }))
    await waitFor(() => expect(screen.getByTestId('version-conflict-banner')).toBeTruthy())
    expect(screen.getByTestId('conflict-server-diff').textContent).toContain(
      '+<h1>Hello v2 from agent</h1>',
    )

    // 保留草稿，基于最新版本保存。
    fireEvent.click(screen.getByRole('button', { name: '将草稿保存为新版本' }))
    await waitFor(() => expect(screen.queryByTestId('version-conflict-banner')).toBeNull())
    expect(attempts.map((a) => a.baseVersion)).toEqual([1, 2])
    expect(screen.getByText('v3')).toBeTruthy()
  })

  it('编辑期间 Agent 并发推送新版本不覆盖未保存草稿，展示实时冲突差异并支持加载最新', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container, rerender } = render(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor artifact={SAMPLE_ARTIFACT} version={V1} />
      </QueryClientProvider>,
    )

    act(() => {
      editCodeMirrorText(container, '<h1>My unsaved draft</h1>')
    })
    await waitFor(() => expect(screen.getByText('未保存')).toBeTruthy())

    // Agent 推送 v2 到达
    rerender(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor
          artifact={{ ...SAMPLE_ARTIFACT, headVersion: 2 }}
          version={V2_AGENT}
          latestVersion={V2_AGENT}
        />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('version-conflict-banner')).toBeTruthy())
    expect(screen.getByTestId('conflict-computed-diff').textContent).toContain('My unsaved draft')
    expect(screen.getByTestId('conflict-computed-diff').textContent).toContain(
      'Hello v2 from agent',
    )

    fireEvent.click(screen.getByRole('button', { name: '放弃草稿并打开最新' }))
    await waitFor(() => expect(screen.queryByTestId('version-conflict-banner')).toBeNull())
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.queryByText('未保存')).toBeNull()
    expect(container.querySelector('.cm-content')?.textContent).toContain('Hello v2 from agent')
  })

  it('ArtifactWorkspace 在 edit 分栏模式下并排展示 CodeMirror 编辑器与实时隔离沙盒 iframe，切图保留草稿', async () => {
    useWorkspaceStore.setState({ viewMode: 'edit', inspectorTab: null })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <ArtifactWorkspace
          detail={{
            artifact: SAMPLE_ARTIFACT,
            version: V1,
            state: {
              artifactId: SAMPLE_ARTIFACT.publicId,
              seq: 0,
              snapshot: {},
              updatedAt: V1.createdAt,
            },
            rounds: [],
          }}
          versions={[V1]}
          sandboxOrigin="http://127.0.0.1:24331"
        />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('l3-code-editor')).toBeTruthy()
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(screen.getByRole('region', { name: '画布' }).contains(iframe)).toBe(true)

    // 切换视图（edit -> preview -> diff -> edit）必须保留未保存草稿而不重建编辑器
    act(() => {
      editCodeMirrorText(container, '<h1>Draft survives view switch</h1>')
    })
    await waitFor(() => expect(screen.getByText('未保存')).toBeTruthy())

    act(() => useWorkspaceStore.setState({ viewMode: 'preview' }))
    act(() => useWorkspaceStore.setState({ viewMode: 'diff' }))
    act(() => useWorkspaceStore.setState({ viewMode: 'edit' }))
    expect(container.querySelector('.cm-content')?.textContent).toContain(
      'Draft survives view switch',
    )
    expect(screen.getByText('未保存')).toBeTruthy()
  })

  it('保存请求在途期间继续键入的修改不会被旧响应覆盖，且历史版本加载最新时同步预览并通知切换', async () => {
    let resolveSave!: (val: { version: Version }) => void
    const savePromise = new Promise<{ version: Version }>((resolve) => {
      resolveSave = resolve
    })

    const previewsWhileSaving: Array<string | null> = []
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor
          artifact={SAMPLE_ARTIFACT}
          version={V1}
          onLivePreviewChange={(src) => previewsWhileSaving.push(src)}
          onSaveOverride={() => savePromise}
        />
      </QueryClientProvider>,
    )

    act(() => {
      editCodeMirrorText(container, '<h1>First edit</h1>')
    })
    await waitFor(() => expect(screen.getByText('未保存')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /^保存/ }))

    // 保存尚未返回时用户继续编辑，并等待 CodeMirror 异步观察器将改动写入编辑器状态
    act(() => {
      editCodeMirrorText(container, '<h1>First edit + typed while saving</h1>')
    })
    await waitFor(() =>
      expect(previewsWhileSaving).toContain('<h1>First edit + typed while saving</h1>'),
    )

    await act(async () => {
      resolveSave({
        version: {
          ...V1,
          version: 2,
          parentVersion: 1,
          author: 'human:web',
          source: '<h1>First edit</h1>',
        },
      })
      await savePromise
    })

    // 基线推进到 v2，但在途期间新增的修改完整保留且保持未保存态
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getByText('未保存')).toBeTruthy()
    expect(container.querySelector('.cm-content')?.textContent).toContain('typed while saving')

    // 历史版本（v1）下采用最新 HEAD（v2）时，必须同步预览为 v2 源码并回调 onVersionAdopted
    cleanup()
    const previews: Array<string | null> = []
    const adopted: Version[] = []
    const { container: histContainer } = render(
      <QueryClientProvider client={qc}>
        <SplitCodeEditor
          artifact={{ ...SAMPLE_ARTIFACT, headVersion: 2 }}
          version={V1}
          latestVersion={V2_AGENT}
          onLivePreviewChange={(src) => previews.push(src)}
          onVersionAdopted={(v) => adopted.push(v)}
        />
      </QueryClientProvider>,
    )
    act(() => {
      editCodeMirrorText(histContainer, '<h1>Stale edit on v1</h1>')
    })
    await waitFor(() => expect(screen.getByTestId('version-conflict-banner')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: '放弃草稿并打开最新' }))
    await waitFor(() => expect(adopted).toHaveLength(1))
    expect(adopted[0]?.version).toBe(2)
    expect(previews.at(-1)).toBe(V2_AGENT.source)
  })
})
