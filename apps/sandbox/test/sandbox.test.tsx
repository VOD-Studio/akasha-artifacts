// @vitest-environment jsdom
import { PROTOCOL_VERSION, type SandboxToShellMessage } from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SandboxApp } from '../src/App'
import { parseSandboxHash, SandboxBridgeClient } from '../src/bridge/client'
import { PreservedStateManager } from '../src/state/preserve'
import { ArtifactStateStore } from '../src/state/store'

declare global {
  var __AK_TEST_MOUNT_COUNT__: number | undefined
}

function createMockBridgeHarness(shellOrigin = 'http://127.0.0.1:24321', nonce = 'test-nonce-1') {
  const posted: Array<{ data: SandboxToShellMessage; targetOrigin: string }> = []
  const hostWindow = {
    postMessage: (data: unknown, targetOrigin: string) => {
      posted.push({ data: data as SandboxToShellMessage, targetOrigin })
    },
  }
  const bridge = new SandboxBridgeClient({
    expectedOrigin: shellOrigin,
    nonce,
    hostWindow,
    listenTarget: window,
  })

  const dispatchFromHost = (data: unknown, opts?: { origin?: string; source?: unknown }) => {
    const evt = new MessageEvent('message', {
      data,
      origin: opts?.origin ?? shellOrigin,
      source: (opts && 'source' in opts ? opts.source : hostWindow) as MessageEventSource,
    })
    window.dispatchEvent(evt)
  }

  return { bridge, posted, hostWindow, dispatchFromHost, shellOrigin, nonce }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.__AK_TEST_MOUNT_COUNT__ = undefined
})

describe('apps/sandbox 运行时与安全边界', () => {
  it('解析 URL hash 并拒绝非法 origin 或 nonce 的 Bridge 消息', () => {
    expect(parseSandboxHash('#origin=http%3A%2F%2F127.0.0.1%3A24321&nonce=abc123')).toEqual({
      origin: 'http://127.0.0.1:24321',
      nonce: 'abc123',
    })
    expect(parseSandboxHash('#origin=javascript:alert(1)&nonce=abc')).toBeNull()
    expect(parseSandboxHash('')).toBeNull()

    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    const received: unknown[] = []
    bridge.onMessage((msg) => received.push(msg))
    bridge.start()

    expect(posted.at(0)?.data).toEqual({ v: PROTOCOL_VERSION, nonce, type: 'ready' })

    // 错误 origin 应被拒收
    dispatchFromHost(
      { v: PROTOCOL_VERSION, nonce, type: 'inspect.start' },
      { origin: 'https://evil.example' },
    )
    // 错误 nonce 应被拒收
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce: 'wrong-nonce', type: 'inspect.start' })
    // 非法结构应被拒收
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce, type: 'unknown.cmd' })
    expect(received).toHaveLength(0)

    // 合法消息应通过
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce, type: 'inspect.start' })
    expect(received).toHaveLength(1)
    bridge.stop()
  })

  it('内置 html / markdown / svg / mermaid 四类渲染器可正确渲染并净化危险标签', async () => {
    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })

    vi.spyOn(mermaid, 'render').mockResolvedValue({
      svg: '<svg viewBox="0 0 100 40"><rect width="100" height="40" /><text>FlowOK</text></svg>',
      diagramType: 'flowchart',
    })

    const { container } = render(
      <SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />,
    )

    // 1. HTML（含恶意 script / onclick，必须被剥离）
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 1,
        source: '<div id="box" onclick="alert(1)">Hello HTML</div><script>window.pwn=1</script>',
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('Hello HTML')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('#box')?.getAttribute('onclick')).toBeNull()

    // 2. Markdown
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'markdown',
        version: 2,
        source: '# 架构设计\n\n- 支持 **GFM**\n\n<script>alert(1)</script>',
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('架构设计')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()

    // 3. SVG
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'svg',
        version: 3,
        source:
          '<svg viewBox="0 0 40 40" onload="alert(1)"><circle cx="20" cy="20" r="10"/><script>bad()</script></svg>',
        state: {},
      })
    })
    await waitFor(() => expect(container.querySelector('svg circle')).toBeTruthy())
    expect(container.querySelector('svg')?.getAttribute('onload')).toBeNull()
    expect(container.querySelector('script')).toBeNull()

    // 4. Mermaid（支持 Inkline 风格切换按钮）
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'mermaid',
        version: 4,
        source: 'flowchart LR\n  A --> B',
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('FlowOK')).toBeTruthy())
    expect(screen.getByText(/Inkline/)).toBeTruthy()
    expect(posted.some((m) => m.data.type === 'rendered' && m.data.version === 4)).toBe(true)
  })

  it('React 渲染器连续接收 100 次 state 补丁时组件绝不重新挂载（mountCount === 1）', async () => {
    const { bridge, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })
    globalThis.__AK_TEST_MOUNT_COUNT__ = 0

    const reactSource = `
      import { useEffect } from 'react'
      import { useArtifactState } from '@akasha/runtime'

      export default function CounterView() {
        const state = useArtifactState<{ step: number }>()
        useEffect(() => {
          globalThis.__AK_TEST_MOUNT_COUNT__ = (globalThis.__AK_TEST_MOUNT_COUNT__ ?? 0) + 1
        }, [])
        return <div data-testid="step-counter">step:{state.step}</div>
      }
    `

    render(<SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />)

    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 1,
        source: reactSource,
        state: { step: 0 },
      })
    })

    await waitFor(() => expect(screen.getByTestId('step-counter').textContent).toBe('step:0'))
    expect(globalThis.__AK_TEST_MOUNT_COUNT__).toBe(1)

    // 连续推送 100 次增量 JSON Patch 状态更新
    act(() => {
      for (let seq = 1; seq <= 100; seq++) {
        dispatchFromHost({
          v: PROTOCOL_VERSION,
          nonce,
          type: 'state',
          seq,
          ops: [{ op: 'replace', path: '/step', value: seq }],
        })
      }
    })

    await waitFor(() => expect(screen.getByTestId('step-counter').textContent).toBe('step:100'))
    expect(globalThis.__AK_TEST_MOUNT_COUNT__).toBe(1)
  })

  it('支持同行分号分隔的连续 import 及全量白名单模块（含 recharts 与 shiki）', async () => {
    const { bridge, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })

    const oneLineImportsSource = `import React from 'react'; import { useState } from 'react'; import { LineChart } from 'recharts'; import { createHighlighter } from 'shiki'; export default function MultiImport() { const [ok] = useState(Boolean(React && LineChart && createHighlighter)); return <div data-testid="multi-import-ok">{ok ? 'all-loaded' : 'missing'}</div> }`

    render(<SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />)
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 1,
        source: oneLineImportsSource,
        state: {},
      })
    })
    await waitFor(() =>
      expect(screen.getByTestId('multi-import-ok').textContent).toBe('all-loaded'),
    )
  })

  it('热更新重绘后保留 data-ak-persist 与 usePersistentControl 用户调参值', async () => {
    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })

    render(<SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />)

    // 1. HTML data-ak-persist 控件保态
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 1,
        source:
          '<label>阈值 <input aria-label="threshold" type="range" data-ak-persist="threshold" min="0" max="100" value="20" /></label>',
        state: {},
      })
    })

    const slider = (await screen.findByLabelText('threshold')) as HTMLInputElement
    expect(slider.value).toBe('20')

    fireEvent.input(slider, { target: { value: '85' } })
    const lastSnapshot = [...posted].reverse().find((m) => m.data.type === 'viewState.snapshot')
    expect(
      lastSnapshot?.data.type === 'viewState.snapshot' && lastSnapshot.data.state.controls,
    ).toEqual({
      threshold: 85,
    })

    // Agent 推送 v2 源码重绘，附带外壳回传的 preservedState
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 2,
        source:
          '<section><h2>v2 新标题</h2><input aria-label="threshold" type="range" data-ak-persist="threshold" min="0" max="100" value="20" /></section>',
        state: {},
        preservedState: { controls: { threshold: 85 }, scrollY: 120 },
      })
    })

    await waitFor(() => expect(screen.getByText('v2 新标题')).toBeTruthy())
    expect((screen.getByLabelText('threshold') as HTMLInputElement).value).toBe('85')

    // 2. React usePersistentControl 保态
    const makeReactSrc = (heading: string) => `
      import { usePersistentControl } from '@akasha/runtime'
      export default function ControlApp() {
        const [gain, setGain] = usePersistentControl('gain', 10)
        return (
          <div>
            <h3>${heading}</h3>
            <span data-testid="gain-val">{gain}</span>
            <button type="button" onClick={() => setGain(75)}>set-75</button>
          </div>
        )
      }
    `

    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 3,
        source: makeReactSrc('React v3'),
        state: {},
      })
    })

    await waitFor(() => expect(screen.getByTestId('gain-val').textContent).toBe('10'))
    fireEvent.click(screen.getByText('set-75'))
    expect(screen.getByTestId('gain-val').textContent).toBe('75')

    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 4,
        source: makeReactSrc('React v4'),
        state: {},
        preservedState: preserved.getSnapshot(),
      })
    })

    await waitFor(() => expect(screen.getByText('React v4')).toBeTruthy())
    expect(screen.getByTestId('gain-val').textContent).toBe('75')
  })

  it('编译越界依赖与运行时异常均经 Bridge error 回传外壳', async () => {
    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />)

    // 非白名单依赖
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 1,
        source:
          "import evil from 'not-allowed-pkg'\nexport default function App() { return <div>{String(evil)}</div> }",
        state: {},
      })
    })

    await waitFor(() =>
      expect(
        posted.some(
          (m) =>
            m.data.type === 'error' &&
            m.data.phase === 'compile' &&
            m.data.message.includes('not-allowed-pkg'),
        ),
      ).toBe(true),
    )

    // 运行时抛出异常
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 2,
        source: 'export default function Boom() { throw new Error("boom-runtime") }',
        state: {},
      })
    })

    await waitFor(() =>
      expect(
        posted.some(
          (m) =>
            m.data.type === 'error' &&
            m.data.phase === 'runtime' &&
            m.data.message.includes('boom-runtime'),
        ),
      ).toBe(true),
    )

    consoleSpy.mockRestore()
  })
})
