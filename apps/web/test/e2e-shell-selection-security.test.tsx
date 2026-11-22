// @vitest-environment jsdom
import {
  type Artifact,
  type Feedback,
  PROTOCOL_VERSION,
  type ReviewRound,
  type Version,
} from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useSelectionStore } from '../src/entities/selection/store'
import { useWorkspaceStore } from '../src/entities/workspace/store'
import type { ArtifactDetailResponse } from '../src/shared/api/client'
import { SANDBOX_IFRAME_SANDBOX_ATTR } from '../src/shared/bridge/host'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace/ArtifactWorkspace'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useWorkspaceStore.setState({
    selectedProjectId: null,
    commandPaletteOpen: false,
    inspectorOpen: true,
    viewMode: 'preview',
    wsStatus: 'closed',
    agentActivityByProject: {},
    presenceByArtifact: {},
    preservedViewByArtifact: {},
    unsentDraftsByArtifact: {},
    sandboxErrorByArtifact: {},
    sentErrorFingerprints: {},
  })
  useSelectionStore.setState({
    pickerActive: false,
    hoveredElement: null,
    selectedByArtifact: {},
    focusedFeedbackId: null,
  })
})

const ARTIFACT: Artifact = {
  publicId: 'E2eArtifactPublicId01',
  slug: 'html/e2e-view',
  projectId: 'proj_e2e',
  title: 'E2E 联调画布',
  type: 'html',
  visibility: 'private',
  headVersion: 1,
  createdAt: '2026-11-22T10:00:00.000Z',
  updatedAt: '2026-11-22T10:00:00.000Z',
}

const V1: Version = {
  artifactId: ARTIFACT.publicId,
  version: 1,
  parentVersion: null,
  author: 'agent:cli',
  title: 'v1',
  source: '<div data-ak-id="panel">v1</div>',
  createdAt: '2026-11-22T10:00:00.000Z',
}

const V2: Version = {
  artifactId: ARTIFACT.publicId,
  version: 2,
  parentVersion: 1,
  author: 'agent:cli',
  title: 'v2',
  source: '<div data-ak-id="panel">v2 updated</div>',
  createdAt: '2026-11-22T10:01:00.000Z',
}

describe('Web 外壳端到端回归（iframe 安全隔离 + 选区防抖同步 + 热更新保留草稿）', () => {
  it('严格使用 sandbox="allow-scripts"（禁用 allow-same-origin），丢弃伪造 Bridge 消息，保留未发草稿并同步选区到 Daemon', async () => {
    const fetchCalls: Array<{ url: string; body?: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      return new Response(JSON.stringify({ selection: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const activeRound: ReviewRound = {
      id: 'rnd_e2e',
      artifactId: ARTIFACT.publicId,
      status: 'drafting',
      groups: [],
      submittedAt: null,
      createdAt: '2026-11-22T10:00:00.000Z',
    }
    const detailV1: ArtifactDetailResponse = {
      artifact: ARTIFACT,
      version: V1,
      state: { artifactId: ARTIFACT.publicId, seq: 0, snapshot: {}, updatedAt: V1.createdAt },
      rounds: [activeRound],
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container, rerender } = render(
      <QueryClientProvider client={qc}>
        <ArtifactWorkspace
          detail={detailV1}
          versions={[V1]}
          feedbacks={[] as readonly Feedback[]}
          sandboxOrigin="http://127.0.0.1:24331"
        />
      </QueryClientProvider>,
    )

    // 0. 首次挂载即使选区为空，也应同步一次空选区到 Daemon（防止页面刷新后残留旧选区上下文）
    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url.includes(`/api/v1/projects/${ARTIFACT.projectId}/selection`) &&
            c.body?.includes('"element":null'),
        ),
      ).toBe(true)
    })

    // 1. iframe 严格设置 sandbox="allow-scripts" 且绝不含 allow-same-origin
    const iframe = container.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe?.getAttribute('sandbox')).toBe(SANDBOX_IFRAME_SANDBOX_ATTR)
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin')

    const hash = new URL(iframe?.getAttribute('src') ?? '').hash
    const nonce = new URLSearchParams(hash.slice(1)).get('nonce') ?? ''
    expect(nonce.length).toBeGreaterThan(8)

    // 2. 伪造 origin 或错误 nonce 的 Bridge 消息必须被丢弃
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://evil.example',
          source: iframe?.contentWindow ?? null,
          data: {
            v: PROTOCOL_VERSION,
            nonce,
            type: 'error',
            phase: 'runtime',
            message: 'forged origin error',
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'null',
          source: iframe?.contentWindow ?? null,
          data: {
            v: PROTOCOL_VERSION,
            nonce: 'wrong-nonce',
            type: 'error',
            phase: 'runtime',
            message: 'forged nonce error',
          },
        }),
      )
    })
    expect(screen.queryByText('forged origin error')).toBeNull()
    expect(screen.queryByText('forged nonce error')).toBeNull()

    // 3. 在批注撰写器输入未发草稿，并模拟合法沙盒指认选中元素 → 防抖同步至 Daemon selection 接口
    const textarea = screen.getByLabelText('批注内容') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: '请保留这段尚未发送的评审草稿' } })

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'null',
          source: iframe?.contentWindow ?? null,
          data: {
            v: PROTOCOL_VERSION,
            nonce,
            type: 'inspect.select',
            reason: 'click',
            element: {
              blockId: 'panel',
              loc: '1:1',
              selector: '[data-ak-id="panel"]',
              textPreview: 'Pricing Panel',
              rect: { x: 12, y: 20, width: 200, height: 60 },
            },
          },
        }),
      )
    })

    await waitFor(() => {
      expect(
        fetchCalls.some(
          (c) =>
            c.url.includes(`/api/v1/projects/${ARTIFACT.projectId}/selection`) &&
            c.body?.includes('"blockId":"panel"') &&
            c.body?.includes('请保留这段尚未发送的评审草稿'),
        ),
      ).toBe(true)
    })

    // 4. Agent 推送 v2 热更新重绘后，未发送的批注草稿依然完整保留
    rerender(
      <QueryClientProvider client={qc}>
        <ArtifactWorkspace
          detail={{ ...detailV1, version: V2, artifact: { ...ARTIFACT, headVersion: 2 } }}
          versions={[V1, V2]}
          feedbacks={[] as readonly Feedback[]}
          sandboxOrigin="http://127.0.0.1:24331"
        />
      </QueryClientProvider>,
    )
    expect((screen.getByLabelText('批注内容') as HTMLTextAreaElement).value).toBe(
      '请保留这段尚未发送的评审草稿',
    )
  })
})
