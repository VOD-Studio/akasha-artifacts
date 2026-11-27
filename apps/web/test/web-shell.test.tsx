// @vitest-environment jsdom
import {
  type Artifact,
  type Feedback,
  PROTOCOL_VERSION,
  type ReviewRound,
  type ShellToSandboxMessage,
  type Version,
} from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

import { type ArtifactDetailResponse, artifactKeys } from '../src/entities/artifact'
import { useSelectionStore } from '../src/entities/selection'
import { useWorkspaceStore } from '../src/entities/workspace'
import { RuntimeErrorPanel } from '../src/features/error-recovery'
import { applyRealtimeEventToCache } from '../src/features/live-sync'
import { AnnotationComposer, ArtifactReviewPanel } from '../src/features/review'
import { RoundSubmitBar } from '../src/features/review/ui/RoundSubmitBar'
import { VersionDiffView } from '../src/features/version-diff'
import { AkashaWsClient } from '../src/shared/api/ws'
import { SANDBOX_IFRAME_SANDBOX_ATTR, SandboxBridgeHost } from '../src/shared/bridge/host'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { TopBar } from '../src/widgets/TopBar'

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

const SAMPLE_V1: Version = {
  artifactId: SAMPLE_ARTIFACT.publicId,
  version: 1,
  parentVersion: null,
  author: 'agent:cli',
  title: '实时状态卡片',
  source: '<div class="p-4">v1 body</div>',
  createdAt: '2026-11-22T09:00:00.000Z',
}

const SAMPLE_V2: Version = {
  artifactId: SAMPLE_ARTIFACT.publicId,
  version: 2,
  parentVersion: 1,
  author: 'agent:cli',
  title: '实时状态卡片 v2',
  source: '<div class="p-4">v2 updated body</div>',
  createdAt: '2026-11-22T09:05:00.000Z',
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  sessionStorage.clear()
  vi.restoreAllMocks()
  useWorkspaceStore.setState({
    selectedProjectId: null,
    commandPaletteOpen: false,
    inspectorTab: null,
    artifactViewId: null,
    viewMode: 'preview',
    wsStatus: 'closed',
    agentActivityByProject: {},
    presenceByArtifact: {},
    preservedViewByArtifact: {},
    sentErrorFingerprints: {},
  })
  useSelectionStore.setState({
    selectedByArtifact: {},
    layersByArtifact: {},
    focusedFeedbackId: null,
  })
})

describe('apps/web 外壳工作台、Bridge 安全与 FSD 分层守卫', () => {
  it('SandboxBridgeHost 仅使用 allow-scripts（禁止 allow-same-origin）并校验 source / origin / nonce', () => {
    expect(SANDBOX_IFRAME_SANDBOX_ATTR).toBe('allow-scripts')
    expect(SANDBOX_IFRAME_SANDBOX_ATTR).not.toContain('allow-same-origin')

    const posted: ShellToSandboxMessage[] = []
    const iframeWin = {
      postMessage: (data: unknown) => {
        posted.push(data as ShellToSandboxMessage)
      },
    }

    const host = new SandboxBridgeHost({
      sandboxOrigin: 'http://127.0.0.1:24331',
      nonce: 'nonce-abc',
      getIframeWindow: () => iframeWin,
    })
    const received: unknown[] = []
    host.onMessage((msg) => received.push(msg))
    host.start()

    // ready 前发送 render 会先入队
    host.send({
      type: 'render',
      artifactType: 'html',
      version: 1,
      source: '<div>hi</div>',
      state: {},
    })
    expect(posted).toHaveLength(0)

    // 伪造 origin / 伪造 source / 伪造 nonce 均须被拒绝
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { v: PROTOCOL_VERSION, nonce: 'nonce-abc', type: 'ready' },
        origin: 'https://evil.example',
        source: iframeWin as unknown as MessageEventSource,
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { v: PROTOCOL_VERSION, nonce: 'wrong-nonce', type: 'ready' },
        origin: 'null',
        source: iframeWin as unknown as MessageEventSource,
      }),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { v: PROTOCOL_VERSION, nonce: 'nonce-abc', type: 'ready' },
        origin: 'null',
        source: window,
      }),
    )
    expect(host.isReady()).toBe(false)
    expect(posted).toHaveLength(0)

    // 合法不透明源 "null" + 匹配 iframeWin + 匹配 nonce 的 ready 触发刷新队列
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { v: PROTOCOL_VERSION, nonce: 'nonce-abc', type: 'ready' },
        origin: 'null',
        source: iframeWin as unknown as MessageEventSource,
      }),
    )
    expect(host.isReady()).toBe(true)
    expect(received).toHaveLength(1)
    expect(posted).toHaveLength(1)
    expect(posted[0]?.type).toBe('render')
    host.stop()
  })

  it('AkashaWsClient 断线重连后携带 lastSeq 订阅，不丢事件', () => {
    vi.useFakeTimers()

    const instances: FakeSocket[] = []
    class FakeSocket {
      static readonly OPEN = 1
      readyState = 0
      sent: string[] = []
      onopen: (() => void) | null = null
      onmessage: ((evt: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(public readonly url: string) {
        instances.push(this)
      }

      send(data: string) {
        this.sent.push(data)
      }

      close() {
        this.readyState = 3
        this.onclose?.()
      }

      triggerOpen() {
        this.readyState = 1
        this.onopen?.()
      }

      triggerMessage(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) })
      }
    }

    const receivedSeqs: number[] = []
    const client = new AkashaWsClient({
      url: 'ws://127.0.0.1:24321/api/v1/ws',
      target: { artifactId: SAMPLE_ARTIFACT.publicId },
      onEvent: (evt) => receivedSeqs.push(evt.seq),
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      baseRetryMs: 100,
    })

    client.connect()
    expect(instances).toHaveLength(1)
    instances[0]?.triggerOpen()
    expect(JSON.parse(instances[0]?.sent[0] ?? '{}')).toMatchObject({
      type: 'subscribe',
      artifactId: SAMPLE_ARTIFACT.publicId,
    })

    // 收到事件 seq=4 与 seq=5
    instances[0]?.triggerMessage({
      v: PROTOCOL_VERSION,
      seq: 4,
      timestamp: '2026-11-22T09:00:00.000Z',
      type: 'presence.changed',
      artifactId: SAMPLE_ARTIFACT.publicId,
      viewers: 1,
      agentOnline: true,
    })
    instances[0]?.triggerMessage({
      v: PROTOCOL_VERSION,
      seq: 5,
      timestamp: '2026-11-22T09:00:01.000Z',
      type: 'presence.changed',
      artifactId: SAMPLE_ARTIFACT.publicId,
      viewers: 2,
      agentOnline: true,
    })
    expect(receivedSeqs).toEqual([4, 5])

    // 模拟网络中断并触发重连
    instances[0]?.close()
    vi.advanceTimersByTime(120)
    expect(instances).toHaveLength(2)
    instances[1]?.triggerOpen()

    expect(JSON.parse(instances[1]?.sent[0] ?? '{}')).toMatchObject({
      type: 'subscribe',
      artifactId: SAMPLE_ARTIFACT.publicId,
      lastSeq: 5,
    })

    client.close()
  })

  it('批注草稿重开后不跟随相似元素或新版换锚点', async () => {
    const queryClient = new QueryClient()
    const submit = vi.fn(async (_input: unknown) => {})
    const original = { boardId: 'desktop', blockId: 'headline', textPreview: '相同标题' }
    const other = { ...original, boardId: 'mobile' }
    const composer = (version: number, selectedElement: typeof original) => (
      <QueryClientProvider client={queryClient}>
        <AnnotationComposer
          artifactId={SAMPLE_ARTIFACT.publicId}
          projectId={SAMPLE_ARTIFACT.projectId}
          version={version}
          activeDraftingRound={null}
          selectedElement={selectedElement}
          onSubmitFeedback={submit}
        />
      </QueryClientProvider>
    )
    const first = render(composer(1, original))
    fireEvent.change(screen.getByLabelText('批注内容'), { target: { value: '恢复原目标的意见' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '同时发送给 Agent' }))
    first.unmount()

    const restored = render(composer(2, other))
    expect(screen.getByDisplayValue('恢复原目标的意见')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '发送' }).disabled).toBe(true)
    expect(screen.getByRole('link', { name: '回 v1 继续' }).getAttribute('href')).toBe(
      `/a/${SAMPLE_ARTIFACT.publicId}/v/1`,
    )
    restored.rerender(composer(1, other))
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '恢复原目标的意见',
        element: original,
        version: 1,
        audience: 'agent',
      }),
    )
    await vi.waitFor(() => expect(screen.queryByDisplayValue('恢复原目标的意见')).toBeNull())
    restored.unmount()
    render(composer(1, original))
    expect(screen.queryByDisplayValue('恢复原目标的意见')).toBeNull()
  })

  it('制品默认打开交互画布，切换工具和 Agent 热更新保留视角、控件与批注草稿', () => {
    const posted: ShellToSandboxMessage[] = []
    const detailV1: ArtifactDetailResponse = {
      artifact: SAMPLE_ARTIFACT,
      version: SAMPLE_V1,
      state: {
        artifactId: SAMPLE_ARTIFACT.publicId,
        seq: 0,
        snapshot: {},
        updatedAt: SAMPLE_V1.createdAt,
      },
      rounds: [],
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const workspace = (detail: ArtifactDetailResponse, versions: readonly Version[]) => (
      <QueryClientProvider client={queryClient}>
        <TopBar
          artifact={detail.artifact}
          version={detail.version}
          versions={versions}
          onBackToLibrary={() => {}}
          onSelectVersion={() => {}}
        />
        <ArtifactWorkspace
          detail={detail}
          versions={versions}
          sandboxOrigin="http://127.0.0.1:24331"
        />
      </QueryClientProvider>
    )
    const { container, rerender } = render(workspace(detailV1, [SAMPLE_V1]))

    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(screen.getByRole('region', { name: '画布' }).contains(iframe)).toBe(true)
    expect(screen.queryByRole('dialog', { name: '批注与评审' })).toBeNull()

    const zoomRatio = () =>
      Number.parseFloat(screen.getByLabelText('画布缩放比例').textContent ?? '')
    const initialZoom = zoomRatio()
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    const previewZoom = zoomRatio()
    expect(previewZoom).toBeGreaterThan(initialZoom)
    fireEvent.keyDown(screen.getByRole('button', { name: '作品菜单' }), { key: 'Enter' })
    fireEvent.click(screen.getByRole('menuitem', { name: '查看源码' }))
    expect(screen.queryByRole('region', { name: '画布' })).toBeNull()
    expect(screen.getByText(SAMPLE_V1.source)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回画布' }))
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(zoomRatio()).toBe(previewZoom)

    const iframeWin = iframe?.contentWindow
    expect(iframeWin).toBeTruthy()
    vi.spyOn(iframeWin as Window, 'postMessage').mockImplementation((msg) => {
      posted.push(msg as ShellToSandboxMessage)
    })

    // 从 iframe hash 提取 nonce
    const hashParams = new URLSearchParams((iframe?.getAttribute('src') ?? '').split('#')[1] ?? '')
    const nonce = hashParams.get('nonce') ?? ''
    expect(nonce.length).toBeGreaterThanOrEqual(16)

    // 模拟沙盒发回 ready 与 viewState.snapshot
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { v: PROTOCOL_VERSION, nonce, type: 'ready' },
          origin: 'null',
          source: iframeWin,
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            v: PROTOCOL_VERSION,
            nonce,
            type: 'viewState.snapshot',
            state: { controls: { threshold: 64 }, scrollY: 180 },
          },
          origin: 'null',
          source: iframeWin,
        }),
      )
    })

    fireEvent.click(screen.getByRole('button', { name: '更多批注选项' }))
    fireEvent.click(screen.getByRole('button', { name: /查看全部批注/ }))
    const drawer = screen.getByRole('dialog', { name: '批注与评审' })
    expect(drawer.getAttribute('aria-modal')).toBe('false')
    const zoomIn = screen.getByRole('button', { name: '放大' })
    act(() => zoomIn.focus())
    expect(document.activeElement).toBe(zoomIn)
    fireEvent.click(zoomIn)
    const reviewZoom = zoomRatio()
    expect(reviewZoom).toBeGreaterThan(previewZoom)
    expect(screen.getByRole('dialog', { name: '批注与评审' })).toBe(drawer)
    const draftInput = screen.getByLabelText('批注内容') as HTMLTextAreaElement
    fireEvent.change(draftInput, { target: { value: '请把按钮改成次要描边样式' } })
    expect(draftInput.value).toBe('请把按钮改成次要描边样式')
    fireEvent.keyDown(draftInput, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '批注与评审' })).toBeNull()

    // 模拟 WS 推送 version.created 写入 Query 缓存并触发工作区重绘 v2
    queryClient.setQueryData(artifactKeys.canvas(SAMPLE_ARTIFACT.publicId), detailV1)
    applyRealtimeEventToCache(queryClient, {
      v: PROTOCOL_VERSION,
      seq: 10,
      timestamp: SAMPLE_V2.createdAt,
      type: 'version.created',
      artifactId: SAMPLE_ARTIFACT.publicId,
      version: SAMPLE_V2,
    })
    const updatedDetail = queryClient.getQueryData<ArtifactDetailResponse>(
      artifactKeys.canvas(SAMPLE_ARTIFACT.publicId),
    )
    expect(updatedDetail?.version.version).toBe(2)

    rerender(workspace(updatedDetail as ArtifactDetailResponse, [SAMPLE_V1, SAMPLE_V2]))

    const v2Render = posted.find((m) => m.type === 'render' && m.version === 2)
    expect(v2Render).toBeTruthy()
    expect(v2Render?.type === 'render' && v2Render.preservedState).toEqual({
      controls: { threshold: 64 },
      scrollY: 180,
    })
    expect(container.querySelector('iframe')).toBe(iframe)
    expect(zoomRatio()).toBe(reviewZoom)
    fireEvent.click(screen.getByRole('button', { name: '更多批注选项' }))
    fireEvent.click(screen.getByRole('button', { name: /查看全部批注/ }))
    expect((screen.getByLabelText('批注内容') as HTMLTextAreaElement).value).toBe(
      '请把按钮改成次要描边样式',
    )

    // 模拟 WS 断线 resync 后重新拉取到更新后的状态快照（版本与源码不变，仅 state.seq 增长）
    const renderCountBeforeResync = posted.filter((m) => m.type === 'render').length
    const resyncedDetail: ArtifactDetailResponse = {
      ...(updatedDetail as ArtifactDetailResponse),
      state: {
        artifactId: SAMPLE_ARTIFACT.publicId,
        seq: 12,
        snapshot: { step: 12, done: true },
        updatedAt: '2026-11-22T09:10:00.000Z',
      },
    }
    rerender(workspace(resyncedDetail, [SAMPLE_V1, SAMPLE_V2]))
    // 不应重发 render 触发重挂载，而应以 state 根路径 replace 同步最新快照
    expect(posted.filter((m) => m.type === 'render')).toHaveLength(renderCountBeforeResync)
    const syncStateMsg = posted.find((m) => m.type === 'state' && m.seq === 12)
    expect(syncStateMsg).toMatchObject({
      type: 'state',
      seq: 12,
      ops: [{ op: 'replace', path: '', value: { step: 12, done: true } }],
    })
  })

  it('VersionDiffView 展示源内容的行级增删', () => {
    render(<VersionDiffView versions={[SAMPLE_V1, SAMPLE_V2]} activeVersion={2} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })

  it('RuntimeErrorPanel 高亮报错源码行、一键提交 runtime_error 给 Agent 并对重复异常去重', async () => {
    const submitted: Array<{ id: string; input: unknown }> = []
    const mockSubmit = vi.fn(async (id: string, input: unknown) => {
      submitted.push({ id, input })
      return {
        feedback: {
          id: 'fb_1',
          artifactId: id,
          version: 1,
          roundId: null,
          groupId: null,
          kind: 'runtime_error' as const,
          element: null,
          body: 'err',
          author: 'human:local',
          draft: false,
          status: 'pending' as const,
          createdAt: '2026-11-22T09:00:00.000Z',
          updatedAt: '2026-11-22T09:00:00.000Z',
        },
      }
    })

    const brokenSource = [
      'export default function App() {',
      '  const x = 1',
      '  return <div>{undefinedVar.foo}</div>',
      '}',
    ].join('\n')

    const { container, rerender } = render(
      <RuntimeErrorPanel
        artifactId={SAMPLE_ARTIFACT.publicId}
        projectId={SAMPLE_ARTIFACT.projectId}
        version={1}
        source={brokenSource}
        error={{
          version: 1,
          phase: 'compile',
          message: 'SyntaxError: Unexpected token',
          loc: '3:16',
        }}
        onDismiss={() => {}}
        onSubmitFeedback={
          mockSubmit as unknown as typeof import('../src/entities/feedback').submitArtifactFeedback
        }
      />,
    )

    // 编译阶段异常的第 3 行原始源码应被高亮展示
    const errorLineEl = container.querySelector('[data-error-line="true"]')
    expect(errorLineEl?.textContent).toContain('undefinedVar.foo')

    // 点击「交给 Agent 修复」提交 kind=runtime_error
    const btn = screen.getByRole('button', { name: '交给 Agent 修复' })
    fireEvent.click(btn)

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatchObject({
      id: SAMPLE_ARTIFACT.publicId,
      input: {
        version: 1,
        kind: 'runtime_error',
        element: { loc: '3:16' },
      },
    })

    // 同一错误重渲染后应显示去重已提交状态，不再允许重复刷屏
    rerender(
      <RuntimeErrorPanel
        artifactId={SAMPLE_ARTIFACT.publicId}
        projectId={SAMPLE_ARTIFACT.projectId}
        version={1}
        source={brokenSource}
        error={{
          version: 1,
          phase: 'compile',
          message: 'SyntaxError: Unexpected token',
          loc: '3:16',
        }}
        onDismiss={() => {}}
        onSubmitFeedback={
          mockSubmit as unknown as typeof import('../src/entities/feedback').submitArtifactFeedback
        }
      />,
    )
    expect(screen.getByText('已交给 Agent 修复')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '交给 Agent 修复' })).toBeNull()

    // 未映射源码坐标的运行时异常不应高亮误导性的原始源码行
    rerender(
      <RuntimeErrorPanel
        artifactId={SAMPLE_ARTIFACT.publicId}
        projectId={SAMPLE_ARTIFACT.projectId}
        version={1}
        source={brokenSource}
        error={{
          version: 1,
          phase: 'runtime',
          message: 'ReferenceError: undefinedVar is not defined',
          loc: '3:16',
          stack: 'ReferenceError: undefinedVar is not defined',
        }}
        onDismiss={() => {}}
        onSubmitFeedback={
          mockSubmit as unknown as typeof import('../src/entities/feedback').submitArtifactFeedback
        }
      />,
    )
    expect(container.querySelector('[data-error-line="true"]')).toBeNull()
  })

  it('元素选区、图钉与 ReviewRound 草稿、提交和撤回互不打断', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const posted: ShellToSandboxMessage[] = []
    const draftingRound: ReviewRound = {
      id: 'round_1',
      artifactId: SAMPLE_ARTIFACT.publicId,
      status: 'drafting',
      groups: [
        {
          id: 'g1',
          title: '选择配色方案',
          kind: 'choose',
          options: ['方案 A', '方案 B'],
          recommended: '方案 B',
          choice: '方案 A',
        },
        {
          id: 'g2',
          title: '核对交互响应',
          kind: 'verify',
          recommended: 'pass',
          verdict: null,
        },
      ],
      submittedAt: null,
      createdAt: '2026-11-22T09:00:00.000Z',
    }

    const oldVersionPin: Feedback = {
      id: 'fb_old',
      artifactId: SAMPLE_ARTIFACT.publicId,
      version: 1,
      roundId: 'round_1',
      groupId: null,
      kind: 'comment',
      element: {
        blockId: 'hero',
        loc: '2:3',
        rect: { x: 24, y: 40, width: 180, height: 48 },
        textPreview: '旧版标题',
      },
      body: '第一版留下的草稿批注',
      author: 'human:local',
      draft: true,
      status: 'pending',
      createdAt: '2026-11-22T09:01:00.000Z',
      updatedAt: '2026-11-22T09:01:00.000Z',
    }

    const currentVersionPin: Feedback = {
      ...oldVersionPin,
      id: 'fb_cur',
      version: 2,
      body: '当前版本草稿批注',
    }

    const detailV2: ArtifactDetailResponse = {
      artifact: { ...SAMPLE_ARTIFACT, headVersion: 2 },
      version: SAMPLE_V2,
      state: {
        artifactId: SAMPLE_ARTIFACT.publicId,
        seq: 0,
        snapshot: {},
        updatedAt: SAMPLE_V2.createdAt,
      },
      rounds: [draftingRound],
    }

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <ArtifactWorkspace
          detail={detailV2}
          versions={[SAMPLE_V1, SAMPLE_V2]}
          feedbacks={[oldVersionPin, currentVersionPin]}
          sandboxOrigin="http://127.0.0.1:24331"
        />
      </QueryClientProvider>,
    )

    const iframe = container.querySelector('iframe')
    const iframeWin = iframe?.contentWindow as Window
    vi.spyOn(iframeWin, 'postMessage').mockImplementation((msg) => {
      posted.push(msg as ShellToSandboxMessage)
    })
    const hashParams = new URLSearchParams((iframe?.getAttribute('src') ?? '').split('#')[1] ?? '')
    const nonce = hashParams.get('nonce') ?? ''

    // 外壳在画布内命中，沙盒只返回坐标与定位，不开启第二种工具。
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { v: PROTOCOL_VERSION, nonce, type: 'ready' },
          origin: 'null',
          source: iframeWin,
        }),
      )
    })
    // 同步向沙盒注册当前版本图钉跟踪
    expect(posted.some((m) => m.type === 'pins.track')).toBe(true)

    const hit = screen.getByRole('button', { name: /^选择画板：/ })
    vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600))
    fireEvent.click(hit, { detail: 1, clientX: 70, clientY: 90 })
    const request = posted.findLast((message) => message.type === 'inspect.at')
    expect(request).toMatchObject({ purpose: 'select', version: 2 })
    if (request?.type !== 'inspect.at') throw new Error('画布未请求命中')
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            v: PROTOCOL_VERSION,
            nonce,
            type: 'inspect.target',
            purpose: 'select',
            requestId: request.requestId,
            version: 2,
            element: {
              blockId: 'hero',
              loc: '4:5',
              rect: { x: 10, y: 20, width: 120, height: 32 },
              textPreview: '主按钮',
            },
          },
          origin: 'null',
          source: iframeWin,
        }),
      )
      // 沙盒实时上报更新后的图钉坐标（例如滚动/侧栏开合后）
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            v: PROTOCOL_VERSION,
            nonce,
            type: 'pins.rects',
            rects: {
              fb_cur: { x: 88, y: 140, width: 160, height: 40 },
            },
          },
          origin: 'null',
          source: iframeWin,
        }),
      )
    })

    expect(screen.queryByRole('dialog', { name: '批注与评审' })).toBeNull()
    expect(screen.getByTestId('overlay-select-box')).toBeTruthy()
    const livePin = screen.getByTestId('annotation-pin-fb_cur')
    expect(livePin.getAttribute('style')).toContain('translate3d(238px, 130px, 0)')
    act(() => useWorkspaceStore.getState().setInspectorTab('review'))
    // 旧版本图钉不叠加在新版本画布上，但在右侧面板中清晰标注「针对 v1」
    expect(screen.queryByTestId('annotation-pin-fb_old')).toBeNull()
    expect(screen.getByTestId('old-version-badge-fb_old').textContent).toBe('针对 v1')

    // 清除选中元素应同步向沙盒发送 highlight(null)，避免滚动后复活旧选区
    fireEvent.click(screen.getByRole('button', { name: '清除选中元素' }))
    expect(posted.some((m) => m.type === 'highlight' && m.element === null)).toBe(true)

    // round.updated 事件须同时刷新历史版本详情缓存（例如 /a/$id/v/1）
    const versionDetailKey = artifactKeys.canvas(SAMPLE_ARTIFACT.publicId, 1)
    queryClient.setQueryData(versionDetailKey, { ...detailV2, rounds: [draftingRound] })
    const submittedRound: ReviewRound = {
      ...draftingRound,
      status: 'submitted',
      submittedAt: '2026-11-22T09:08:00.000Z',
    }
    applyRealtimeEventToCache(queryClient, {
      v: PROTOCOL_VERSION,
      seq: 99,
      timestamp: '2026-11-22T09:08:00.000Z',
      type: 'round.updated',
      artifactId: SAMPLE_ARTIFACT.publicId,
      round: submittedRound,
    })
    const refreshedVersionDetail =
      queryClient.getQueryData<ArtifactDetailResponse>(versionDetailKey)
    expect(refreshedVersionDetail?.rounds[0]?.status).toBe('submitted')

    // 选中画布元素打开批注抽屉，轮次动作随抽屉出现。
    const roundBar = screen.getByTestId('round-submit-bar')
    expect(screen.getByRole('dialog', { name: '批注与评审' }).contains(roundBar)).toBe(true)
    expect(roundBar.textContent).toContain('已评审 1 / 2 项')
    expect(roundBar.textContent).toContain('草稿 2 条')
    expect(screen.getByRole('button', { name: '提交本轮' })).toBeTruthy()

    cleanup()

    // 3. 验证在草稿轮次中撰写批注带 roundId、version 与 ElementRef，点击提交本轮与撤回回调准确触发
    const submittedPayloads: unknown[] = []
    const submittedRounds: string[] = []
    const withdrawnRounds: string[] = []
    const selectedEl = { blockId: 'hero', loc: '4:5', textPreview: '主按钮' }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AnnotationComposer
          artifactId={SAMPLE_ARTIFACT.publicId}
          projectId={SAMPLE_ARTIFACT.projectId}
          version={2}
          activeDraftingRound={draftingRound}
          selectedElement={selectedEl}
          onSubmitFeedback={async (payload) => {
            submittedPayloads.push(payload)
          }}
        />
        <RoundSubmitBar
          artifactId={SAMPLE_ARTIFACT.publicId}
          projectId={SAMPLE_ARTIFACT.projectId}
          activeRound={draftingRound}
          feedbacks={[currentVersionPin]}
          onSubmitRound={async (rid) => {
            submittedRounds.push(rid)
          }}
          onWithdrawRound={async (rid) => {
            withdrawnRounds.push(rid)
          }}
        />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('批注内容'), {
      target: { value: '圆角稍微加大一点' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await vi.waitFor(() => expect(submittedPayloads).toHaveLength(1))
    expect(submittedPayloads[0]).toMatchObject({
      version: 2,
      roundId: 'round_1',
      kind: 'comment',
      audience: 'human',
      element: selectedEl,
      body: '圆角稍微加大一点',
    })

    fireEvent.change(screen.getByLabelText('批注内容'), { target: { value: '请调整标题间距' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '随本轮发给 Agent' }))
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await vi.waitFor(() => expect(submittedPayloads).toHaveLength(2))
    expect(submittedPayloads[1]).toMatchObject({
      roundId: 'round_1',
      audience: 'agent',
      element: selectedEl,
      body: '请调整标题间距',
    })

    fireEvent.click(screen.getByRole('button', { name: '提交本轮' }))
    await vi.waitFor(() => expect(submittedRounds).toEqual(['round_1']))

    // 提交后可撤回当前轮次
    rerender(
      <QueryClientProvider client={queryClient}>
        <ArtifactReviewPanel
          artifactId={SAMPLE_ARTIFACT.publicId}
          projectId={SAMPLE_ARTIFACT.projectId}
          activeVersion={2}
          activeRound={null}
          feedbacks={[{ ...currentVersionPin, draft: false, status: 'resolved' }]}
        />
        <RoundSubmitBar
          artifactId={SAMPLE_ARTIFACT.publicId}
          projectId={SAMPLE_ARTIFACT.projectId}
          activeRound={{
            ...draftingRound,
            status: 'submitted',
            submittedAt: '2026-11-22T09:05:00.000Z',
          }}
          feedbacks={[{ ...currentVersionPin, draft: false, status: 'resolved' }]}
          onWithdrawRound={async (rid) => {
            withdrawnRounds.push(rid)
          }}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Agent 已处理')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '撤回本轮' }))
    await vi.waitFor(() => expect(withdrawnRounds).toEqual(['round_1']))
  })
})
