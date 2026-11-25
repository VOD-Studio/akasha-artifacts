import { type Artifact, type Feedback, PROTOCOL_VERSION, type Version } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type { ArtifactDetailResponse } from '../src/entities/artifact'
import { useSelectionStore } from '../src/entities/selection'
import { useWorkspaceStore } from '../src/entities/workspace'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'

export const artifact: Artifact = {
  publicId: 'CanvasExamplePublicId1',
  slug: 'artboard/reservation',
  projectId: 'project-canvas',
  title: '茶席预约',
  type: 'artboard',
  visibility: 'private',
  headVersion: 1,
  createdAt: '2026-11-22T09:00:00.000Z',
  updatedAt: '2026-11-22T09:00:00.000Z',
}

export const design = {
  pages: [
    { id: 'reserve', title: '预约流程' },
    { id: 'status', title: '状态' },
  ],
  boards: [
    {
      id: 'desktop',
      title: '宽屏首页',
      pageId: 'reserve',
      viewport: { width: 1440, height: 900 },
      html: '<h1>桌面预约</h1>',
    },
    {
      id: 'mobile',
      title: '手机首页',
      pageId: 'reserve',
      viewport: { width: 390, height: 844 },
      html: '<h1 data-ak-block="mobile-details">手机预约</h1>',
    },
    { id: 'success', title: '预约完成', pageId: 'status', description: '已确认时段' },
  ],
}

export function detailFor(
  versionNumber = 1,
  source = JSON.stringify(design),
): ArtifactDetailResponse {
  const version: Version = {
    artifactId: artifact.publicId,
    version: versionNumber,
    parentVersion: versionNumber === 1 ? null : versionNumber - 1,
    author: 'agent:cli',
    title: artifact.title,
    source,
    createdAt: artifact.createdAt,
  }
  return {
    artifact: { ...artifact, headVersion: versionNumber },
    version,
    state: {
      artifactId: artifact.publicId,
      snapshot: {},
      seq: 0,
      updatedAt: version.createdAt,
    },
    rounds: [],
  }
}

export function workspace(detail = detailFor(), feedbacks?: readonly Feedback[]) {
  return (
    <ArtifactWorkspace
      detail={detail}
      versions={[detail.version]}
      feedbacks={feedbacks}
      sandboxOrigin="http://127.0.0.1:24331"
    />
  )
}

export function showWorkspace(detail = detailFor(), feedbacks?: readonly Feedback[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (view: React.ReactNode) => (
    <QueryClientProvider client={client}>{view}</QueryClientProvider>
  )
  const view = render(wrap(workspace(detail, feedbacks)))
  return { ...view, update: (element: React.ReactNode) => view.rerender(wrap(element)) }
}

export function sandbox(frame: HTMLIFrameElement) {
  const win = frame.contentWindow
  if (!win) throw new Error('测试画板未建立独立窗口')
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')
  return {
    nonce,
    post: vi.spyOn(win, 'postMessage').mockImplementation(() => {}),
    receive(data: Record<string, unknown>) {
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'null',
          source: win,
          data: { ...data, v: PROTOCOL_VERSION, nonce },
        }),
      )
    },
  }
}

export function stubResizeObserver() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // JSDOM 没有元素滚动方法；Tabs 用它保持新选中的标签可见。
  HTMLElement.prototype.scrollIntoView ??= vi.fn()
}

export function showEditableWorkspace(
  initial: ArtifactDetailResponse,
  address?: string,
  refreshDetails?: Promise<void>,
) {
  const view = showWorkspace(initial)
  const editable = (detail: ArtifactDetailResponse) => (
    <ArtifactWorkspace
      detail={detail}
      versions={[detail.version]}
      sandboxOrigin="http://127.0.0.1:24331"
      address={address}
      onVersionSaved={async (version) => {
        if (refreshDetails) await refreshDetails
        view.update(editable(detailFor(version.version, version.source)))
      }}
    />
  )
  let submittedVersion: number | undefined
  let current = initial
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    if (input === '/api/v1/artifacts' && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body))
      submittedVersion = payload.baseVersion
      current = detailFor(current.version.version + 1, payload.source)
      return Response.json(current)
    }
    return Response.json({ selection: null })
  })
  view.update(editable(initial))
  return {
    get current() {
      return current
    },
    get submittedVersion() {
      return submittedVersion
    },
    receiveAgentSource(source: string) {
      current = detailFor(current.version.version + 1, source)
      view.update(editable(current))
    },
  }
}

export function setupCanvasTest() {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(2400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(2100)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useSelectionStore.getState().clearSelection(artifact.publicId)
    useWorkspaceStore.setState({ inspectorTab: null, viewMode: 'preview' })
    sessionStorage.clear()
  })
}
