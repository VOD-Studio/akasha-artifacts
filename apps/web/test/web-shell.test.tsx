// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type Artifact,
  PROTOCOL_VERSION,
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

import { artifactKeys } from '../src/entities/artifact/queries'
import { projectKeys } from '../src/entities/project/queries'
import { useWorkspaceStore } from '../src/entities/workspace/store'
import { applyRealtimeEventToCache } from '../src/features/live-sync/useLiveSync'
import { VersionDiffView } from '../src/features/version-diff/VersionDiffView'
import type { ArtifactDetailResponse } from '../src/shared/api/client'
import { AkashaWsClient } from '../src/shared/api/ws'
import { SANDBOX_IFRAME_SANDBOX_ATTR, SandboxBridgeHost } from '../src/shared/bridge/host'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace/ArtifactWorkspace'
import { LibraryShell } from '../src/widgets/LibraryShell/LibraryShell'

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
  vi.restoreAllMocks()
  useWorkspaceStore.setState({
    selectedProjectId: null,
    commandPaletteOpen: false,
    viewMode: 'preview',
    wsStatus: 'closed',
    agentActivityByProject: {},
    presenceByArtifact: {},
    preservedViewByArtifact: {},
    unsentDraftsByArtifact: {},
    sandboxErrorByArtifact: {},
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

  it('ArtifactWorkspace 在 Agent 发布新版本重绘时保留视图/控件快照与未发草稿', () => {
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

    const { container, rerender } = render(
      <ArtifactWorkspace
        detail={detailV1}
        versions={[SAMPLE_V1]}
        sandboxOrigin="http://127.0.0.1:24331"
      />,
    )

    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')

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

    // 用户在底栏输入未提交批注草稿
    const draftInput = screen.getByLabelText('未提交批注草稿') as HTMLInputElement
    fireEvent.change(draftInput, { target: { value: '请把按钮改成次要描边样式' } })
    expect(draftInput.value).toBe('请把按钮改成次要描边样式')

    // 模拟 WS 推送 version.created 写入 Query 缓存并触发工作区重绘 v2
    const queryClient = new QueryClient()
    queryClient.setQueryData(artifactKeys.detail(SAMPLE_ARTIFACT.publicId, undefined), detailV1)
    applyRealtimeEventToCache(queryClient, {
      v: PROTOCOL_VERSION,
      seq: 10,
      timestamp: SAMPLE_V2.createdAt,
      type: 'version.created',
      artifactId: SAMPLE_ARTIFACT.publicId,
      version: SAMPLE_V2,
    })
    const updatedDetail = queryClient.getQueryData<ArtifactDetailResponse>(
      artifactKeys.detail(SAMPLE_ARTIFACT.publicId, undefined),
    )
    expect(updatedDetail?.version.version).toBe(2)

    rerender(
      <ArtifactWorkspace
        detail={updatedDetail as ArtifactDetailResponse}
        versions={[SAMPLE_V1, SAMPLE_V2]}
        sandboxOrigin="http://127.0.0.1:24331"
      />,
    )

    const v2Render = posted.find((m) => m.type === 'render' && m.version === 2)
    expect(v2Render).toBeTruthy()
    expect(v2Render?.type === 'render' && v2Render.preservedState).toEqual({
      controls: { threshold: 64 },
      scrollY: 180,
    })
    // 重绘后未提交草稿完好保留
    expect((screen.getByLabelText('未提交批注草稿') as HTMLInputElement).value).toBe(
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
    rerender(
      <ArtifactWorkspace
        detail={resyncedDetail}
        versions={[SAMPLE_V1, SAMPLE_V2]}
        sandboxOrigin="http://127.0.0.1:24331"
      />,
    )
    // 不应重发 render 触发重挂载，而应以 state 根路径 replace 同步最新快照
    expect(posted.filter((m) => m.type === 'render')).toHaveLength(renderCountBeforeResync)
    const syncStateMsg = posted.find((m) => m.type === 'state' && m.seq === 12)
    expect(syncStateMsg).toMatchObject({
      type: 'state',
      seq: 12,
      ops: [{ op: 'replace', path: '', value: { step: 12, done: true } }],
    })
  })

  it('LibraryShell 支持多项目切换、休眠项目折叠，VersionDiffView 准确展示行级差异', () => {
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
    queryClient.setQueryData(artifactKeys.list(undefined), [SAMPLE_ARTIFACT])

    const opened: string[] = []
    render(
      <QueryClientProvider client={queryClient}>
        <LibraryShell onOpenArtifact={(id) => opened.push(id)} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('最近 · 所有项目')).toBeTruthy()
    expect(screen.getAllByText('Alpha Repo').length).toBeGreaterThanOrEqual(1)
    // 休眠项目默认折叠
    expect(screen.queryByText('Legacy Repo')).toBeNull()
    fireEvent.click(screen.getByText(/休眠项目（1）/))
    expect(screen.getByText('Legacy Repo')).toBeTruthy()

    fireEvent.click(screen.getByText('实时状态卡片'))
    expect(opened).toEqual([SAMPLE_ARTIFACT.publicId])

    cleanup()
    render(<VersionDiffView versions={[SAMPLE_V1, SAMPLE_V2]} activeVersion={2} />)
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('-1')).toBeTruthy()
  })

  it('反向 FSD 依赖（entities → features）会被 scripts/check-deps.mjs 拦截', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'akasha-fsd-test-'))
    try {
      const entitiesDir = path.join(tmpRoot, 'apps', 'web', 'src', 'entities')
      fs.mkdirSync(entitiesDir, { recursive: true })
      fs.writeFileSync(
        path.join(tmpRoot, 'apps', 'web', 'package.json'),
        JSON.stringify({ name: '@akasha/web' }),
      )
      fs.writeFileSync(
        path.join(entitiesDir, 'illegal.ts'),
        "import { foo } from '../features/live-sync/useLiveSync'\nexport const x = foo\n",
      )

      const scriptPath = path.resolve(process.cwd(), 'scripts/check-deps.mjs')
      let failed = false
      let output = ''
      try {
        execFileSync(process.execPath, [scriptPath], {
          cwd: tmpRoot,
          encoding: 'utf8',
          stdio: 'pipe',
        })
      } catch (err) {
        failed = true
        const e = err as { stderr?: string; stdout?: string }
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`
      }

      expect(failed).toBe(true)
      expect(output).toContain('违反外壳 FSD 分层 entities → features')
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })
})
