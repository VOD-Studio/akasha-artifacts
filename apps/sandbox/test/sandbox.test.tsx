// @vitest-environment jsdom
import { PROTOCOL_VERSION, type SandboxToShellMessage } from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import mermaid from 'mermaid'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SandboxApp } from '../src/App'
import { parseSandboxHash, SandboxBridgeClient } from '../src/bridge/client'
import * as capturePng from '../src/capture/png'
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
      { v: PROTOCOL_VERSION, nonce, type: 'highlight', element: null },
      { origin: 'https://evil.example' },
    )
    // 错误 nonce 应被拒收
    dispatchFromHost({
      v: PROTOCOL_VERSION,
      nonce: 'wrong-nonce',
      type: 'highlight',
      element: null,
    })
    // 非法结构应被拒收
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce, type: 'unknown.cmd' })
    expect(received).toHaveLength(0)

    // 合法消息应通过
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce, type: 'highlight', element: null })
    expect(received).toHaveLength(1)
    bridge.stop()
  })

  it('只更新相同版本、相同画板的参数，保留正在输入的原型控件', () => {
    const { bridge, dispatchFromHost, nonce } = createMockBridgeHarness()
    const { container } = render(
      <SandboxApp
        bridge={bridge}
        stateStore={new ArtifactStateStore()}
        preserved={new PreservedStateManager({ debounceMs: 0 })}
      />,
    )
    const send = (message: object) =>
      act(() => dispatchFromHost({ v: PROTOCOL_VERSION, nonce, ...message }))
    const board = {
      type: 'render',
      artifactType: 'html',
      boardId: 'x2',
      source: '<label>姓名 <input></label>',
      boardAppearance: { background: '#dddddd', cornerRadius: 18 },
      state: {},
    }
    send({ ...board, version: 1, boardTweaks: { duration: 2, visible: true } })
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: '姓名' })
    fireEvent.input(input, { target: { value: '未提交' } })
    const root = container.firstElementChild as HTMLElement
    const duration = () => root.style.getPropertyValue('--akasha-tweak-duration')
    expect(duration()).toBe('2')
    expect(root.style.borderRadius).toBe('18px')

    const preview = {
      type: 'board.tweaks.preview',
      boardId: 'x2',
      version: 1,
      values: { duration: 4, visible: false },
    }
    send({ ...preview, boardId: 'x3' })
    expect(duration()).toBe('2')
    send(preview)
    expect(duration()).toBe('4')
    expect(root.style.getPropertyValue('--akasha-tweak-visible')).toBe('0')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: '姓名' }).value).toBe('未提交')

    send({ ...board, version: 2, boardTweaks: { duration: 7 } })
    send(preview)
    expect(duration()).toBe('7')
    expect(root.style.getPropertyValue('--akasha-tweak-visible')).toBe('')
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

  it('React 运行状态启用控件后才开放当前版本的试玩', async () => {
    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    render(
      <SandboxApp
        bridge={bridge}
        stateStore={new ArtifactStateStore()}
        preserved={new PreservedStateManager()}
      />,
    )
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 4,
        source: `
          import { useArtifactState } from '@akasha/runtime'
          export default function Preview() {
            const { available } = useArtifactState()
            return <button disabled={!available}>继续</button>
          }
        `,
        state: { available: false },
      })
    })
    await waitFor(() =>
      expect(posted.map(({ data }) => data)).toContainEqual(
        expect.objectContaining({ type: 'rendered', version: 4, playable: false }),
      ),
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '继续' }).disabled).toBe(true)
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'state',
        seq: 1,
        ops: [{ op: 'replace', path: '/available', value: true }],
      })
    })
    await waitFor(() =>
      expect(posted.map(({ data }) => data)).toContainEqual(
        expect.objectContaining({ type: 'prototype.availability', version: 4, playable: true }),
      ),
    )
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '继续' }).disabled).toBe(false)
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
    // React 编译后的组件与外部保态订阅异步提交，先等控件实际显示新值。
    await waitFor(() => expect(screen.getByTestId('gain-val').textContent).toBe('75'))

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

  it('按画布坐标命中节点但不触发作者控件，保留批注定位', async ({ onTestFinished }) => {
    const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })

    const reactSource = [
      'export default function InspectTarget() {',
      '  const items = ["甲", "乙"]',
      '  return (',
      '    <div>',
      '      <section data-ak-block="summary-card">',
      '        <h2>概览标题</h2>',
      '      </section>',
      '      <ul>',
      '        {items.map((item) => (',
      '          <li key={item}>{item}</li>',
      '        ))}',
      '      </ul>',
      '    </div>',
      '  )',
      '}',
    ].join('\n')

    const { container } = render(
      <SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />,
    )

    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 1,
        source: reactSource,
        state: {},
      })
    })

    const heading = await screen.findByText('概览标题')
    const listItem = await screen.findByText('乙')
    const domCountBeforeInspect = container.querySelectorAll('*').length

    const original = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
    const hitTest = vi.fn<(x: number, y: number) => Element | null>()
    Object.defineProperty(document, 'elementFromPoint', { value: hitTest, configurable: true })
    onTestFinished(() => {
      if (original) Object.defineProperty(document, 'elementFromPoint', original)
      else Reflect.deleteProperty(document, 'elementFromPoint')
    })
    const pick = (target: Element, version: number) => {
      const requestId = `pick-${posted.length}`
      hitTest.mockReturnValueOnce(target)
      act(() =>
        dispatchFromHost({
          v: PROTOCOL_VERSION,
          nonce,
          type: 'inspect.at',
          purpose: 'select',
          x: 10,
          y: 20,
          requestId,
          version,
        }),
      )
      const result = posted.findLast(
        ({ data }) => data.type === 'inspect.target' && data.requestId === requestId,
      )
      return result?.data.type === 'inspect.target' ? result.data.element : undefined
    }
    const clicked = vi.fn()
    heading.addEventListener('click', clicked)
    expect(pick(heading, 1)).toMatchObject({
      blockId: 'summary-card',
      loc: '6:9',
      textPreview: '概览标题',
    })
    expect(clicked).not.toHaveBeenCalled()

    // .map() 生成的动态项没有块标识，仍可按精确源码位置锚定。
    const selectedItem = pick(listItem, 1)
    expect(selectedItem).toMatchObject({
      loc: '10:11',
      textPreview: '乙',
    })
    expect(selectedItem?.blockId).toBeUndefined()

    // 验证沙盒内未注入任何外壳高亮 UI DOM
    expect(container.querySelectorAll('*').length).toBe(domCountBeforeInspect)

    // HTML 渲染器同样注入 data-ak-loc 并可命中
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 2,
        source: '<article>\n  <p>纯 HTML 段落</p>\n</article>',
        state: {},
      })
    })
    const htmlPara = await screen.findByText('纯 HTML 段落')
    expect(pick(htmlPara, 2)).toMatchObject({
      loc: '2:3',
      textPreview: '纯 HTML 段落',
    })

    // 仅含 textPreview 的 highlight 指令也能通过最终降级定位命中目标节点
    const prevCount = posted.length
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'highlight',
        element: { textPreview: '纯 HTML 段落' },
      })
    })
    const highlightHit = posted.slice(prevCount).find((m) => m.data.type === 'inspect.select')
    expect(highlightHit?.data.type === 'inspect.select' && highlightHit.data).toMatchObject({
      reason: 'sync',
      element: {
        loc: '2:3',
        textPreview: '纯 HTML 段落',
      },
    })

    // pins.track 应立即解析并回传 pins.rects 供外壳叠层渲染实时图钉坐标
    const beforePins = posted.length
    act(() => {
      dispatchFromHost({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'pins.track',
        pins: [{ id: 'pin_1', element: { loc: '2:3' } }],
      })
    })
    const pinRectsMsg = posted.slice(beforePins).find((m) => m.data.type === 'pins.rects')
    expect(pinRectsMsg?.data.type === 'pins.rects' && pinRectsMsg.data.rects.pin_1).toBeTruthy()
  })
})

it('总览取消等待字体的截图时，不栅格化该请求的画板', async ({ onTestFinished }) => {
  const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
  const fonts = Promise.withResolvers<void>()
  const original = Object.getOwnPropertyDescriptor(document, 'fonts')
  Object.defineProperty(document, 'fonts', { value: { ready: fonts.promise }, configurable: true })
  onTestFinished(() => {
    if (original) Object.defineProperty(document, 'fonts', original)
    else Reflect.deleteProperty(document, 'fonts')
  })
  render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  const envelope = { v: PROTOCOL_VERSION, nonce }
  act(() =>
    dispatchFromHost({
      ...envelope,
      type: 'render',
      artifactType: 'html',
      source: '<h1>截图取消</h1>',
      state: {},
      boardId: 'cover',
      version: 1,
      renderId: 1,
      overviewAnimation: true,
    }),
  )
  await waitFor(() => {
    expect(posted.some(({ data }) => data.type === 'rendered' && data.renderId === 1)).toBe(true)
  })
  act(() => {
    dispatchFromHost({
      ...envelope,
      type: 'capture.png',
      requestId: 'preview',
      version: 1,
      width: 320,
      height: 180,
      scale: 0.5,
    })
    dispatchFromHost({ ...envelope, type: 'capture.cancel', requestId: 'preview' })
    fonts.resolve()
  })
  await waitFor(() => {
    expect(posted.find(({ data }) => data.type === 'capture.png.failure')?.data).toMatchObject({
      requestId: 'preview',
      message: '已取消预览',
    })
  })
  expect(posted.some(({ data }) => data.type === 'capture.png.result')).toBe(false)
})

it('总览只截取已保存的默认参数，重置后恢复截图且切版不串旧请求', async () => {
  const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
  const pending = Promise.withResolvers<Blob>()
  const png = new Blob(['PNG'])
  const captured: string[] = []
  const rasterize = vi.spyOn(capturePng, 'captureSandboxPng').mockImplementation((root) => {
    captured.push(root.style.getPropertyValue('--akasha-tweak-duration'))
    return captured.length === 1 ? pending.promise : Promise.resolve(png)
  })
  const { container } = render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  const send = (message: object) => dispatchFromHost({ v: PROTOCOL_VERSION, nonce, ...message })
  const board = {
    type: 'render',
    artifactType: 'html',
    source: '<h1>默认参数截图</h1>',
    state: {},
    boardId: 'cover',
    version: 1,
    renderId: 1,
    overviewAnimation: true,
    boardTweaks: { duration: 2 },
  }
  const preview = {
    type: 'board.tweaks.preview',
    boardId: 'cover',
    version: 1,
    values: { duration: 5 },
  }
  const capture = (requestId: string, version = 1) =>
    send({ type: 'capture.png', requestId, version, width: 320, height: 180, scale: 0.5 })
  const response = (requestId: string) =>
    posted.find(({ data }) => 'requestId' in data && data.requestId === requestId)?.data
  const rendered = (renderId: number) =>
    posted.filter(({ data }) => data.type === 'rendered' && data.renderId === renderId)
  const root = container.firstElementChild as HTMLElement
  const duration = () => root.style.getPropertyValue('--akasha-tweak-duration')

  act(() => {
    send(board)
    send(preview)
  })
  expect(rendered(1)).toHaveLength(1)
  expect(duration()).toBe('5')
  act(() => capture('active'))
  expect(response('active')).toMatchObject({ type: 'capture.png.failure' })

  act(() => {
    send({ ...preview, values: board.boardTweaks })
    capture('before-reset')
  })
  expect(response('before-reset')).toMatchObject({ type: 'capture.png.failure' })
  expect(rasterize).not.toHaveBeenCalled()
  expect(rendered(1)).toHaveLength(2)
  expect(duration()).toBe('2')

  act(() => {
    send(preview)
    capture('before-preview')
    send({ ...preview, values: board.boardTweaks })
  })
  expect(response('before-preview')).toMatchObject({ type: 'capture.png.failure' })
  expect(rasterize).not.toHaveBeenCalled()

  act(() => capture('old'))
  const oldSignal = rasterize.mock.calls[0]?.[4]
  expect(oldSignal?.aborted).toBe(false)
  act(() => send(preview))
  expect(oldSignal?.aborted).toBe(true)

  act(() => {
    send({ ...board, renderId: 2, version: 2, boardTweaks: { duration: 7 } })
    send(preview)
    pending.resolve(png)
  })
  await waitFor(() => expect(response('old')).toMatchObject({ type: 'capture.png.failure' }))
  expect(rendered(2)).toHaveLength(1)
  expect(duration()).toBe('7')
  act(() => capture('current', 2))
  await waitFor(() => {
    expect(response('current')).toMatchObject({ type: 'capture.png.result', version: 2, png })
  })
  expect(captured).toEqual(['2', '7'])
})

it('原生图层和作者 HTML 独立渲染，同名标记不能接走原生图层的批注定位', async () => {
  const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
  const { container } = render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  act(() => {
    dispatchFromHost({
      v: PROTOCOL_VERSION,
      nonce,
      type: 'render',
      artifactType: 'html',
      boardId: 'example',
      version: 2,
      source: '<main><p data-ak-block="design-layer:note">作者的同名段落</p></main>',
      designLayers: [
        { kind: 'note', id: 'note', text: '原生便签', x: 30, y: 40, width: 160, height: 100 },
      ],
      state: {},
    })
    dispatchFromHost({ v: PROTOCOL_VERSION, nonce, type: 'inspect.layers.watch', active: true })
  })
  expect(await screen.findByText('作者的同名段落')).toBeTruthy()
  const native = await screen.findByText('原生便签')
  expect(native.style.left).toBe('30px')
  await waitFor(() => {
    const report = posted.find(
      ({ data }) => data.type === 'inspect.layers.snapshot' && data.version === 2,
    )
    if (report?.data.type !== 'inspect.layers.snapshot') throw new Error('缺少 v2 的图层快照')
    expect(report.data.layers.filter((layer) => layer.designId === 'note')).toEqual([
      expect.objectContaining({ label: '原生便签', designId: 'note' }),
    ])
  })
  const count = posted.length
  act(() =>
    dispatchFromHost({
      v: PROTOCOL_VERSION,
      nonce,
      type: 'highlight',
      element: { boardId: 'example', blockId: 'design-layer:note' },
    }),
  )
  expect(
    posted.slice(count).find(({ data }) => data.type === 'inspect.select')?.data,
  ).toMatchObject({
    reason: 'sync',
    version: 2,
    element: { blockId: 'design-layer:note', textPreview: '原生便签' },
    presentation: expect.objectContaining({ isText: true }),
  })
  expect(container.querySelector('p')?.getAttribute('data-ak-loc')).toBe('1:7')
})

it('原生图层按排版、自定义十六进制色与镜像翻转渲染', async () => {
  const { bridge, dispatchFromHost, nonce } = createMockBridgeHarness()
  render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  act(() => {
    dispatchFromHost({
      v: PROTOCOL_VERSION,
      nonce,
      type: 'render',
      artifactType: 'html',
      boardId: 'styled',
      version: 1,
      source: '',
      designLayers: [
        {
          id: 'title',
          kind: 'text',
          x: 10,
          y: 20,
          width: 240,
          height: 60,
          text: '加粗居中',
          color: '#1d4ed8',
          fontSize: 24,
          fontWeight: 'bold',
          textAlign: 'center',
          flipX: true,
        },
        {
          id: 'badge',
          kind: 'ellipse',
          x: 20,
          y: 90,
          width: 80,
          height: 80,
          color: '#ef4444',
          flipY: true,
        },
      ],
      state: {},
    })
  })
  const textLayer = await screen.findByText('加粗居中')
  expect(textLayer.style.fontSize).toBe('24px')
  expect(textLayer.style.fontWeight).toBe('700')
  expect(textLayer.style.textAlign).toBe('center')
  expect(textLayer.style.color).toBe('rgb(29, 78, 216)')
  expect(textLayer.style.transform).toBe('scale(-1, 1)')
  const shapeLayer = screen.getByTitle('椭圆')
  expect(shapeLayer.style.backgroundColor).toBe('rgb(239, 68, 68)')
  expect(shapeLayer.style.transform).toBe('scale(1, -1)')
})

it('只有专用纸宽帧按固定版读取页，保留版内外观和图层，不采纳临时预览', async () => {
  const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
  const { container } = render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  const send = (message: object) => dispatchFromHost({ v: PROTOCOL_VERSION, nonce, ...message })
  const base = {
    type: 'render',
    version: 3,
    boardId: 'reading',
    artifactType: 'html',
    state: {},
    source: '<p>作者正文</p>',
    boardAppearance: { background: '#f0f0f0' },
    boardTweaks: { spacing: 8 },
    designLayers: [
      { id: 'footer', kind: 'text', x: 30, y: 2400, width: 200, height: 40, text: '页尾图层' },
    ],
  }
  act(() => send(base))
  act(() => send({ type: 'capture.print', version: 3, page: 0 }))
  expect(posted.at(-1)?.data).toMatchObject({ type: 'capture.print.failure', version: 3, page: 0 })
  const image = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22/%3E'
  const images = Array.from({ length: 18 }, (_, i) => `<img alt="${i}" src="${image}#${i}">`)
  const source = `${base.source}${images.join('')}<video autoplay></video>`
  act(() => send({ ...base, source, version: 4, printPaper: 'letter' }))
  await waitFor(() => {
    expect(posted.some(({ data }) => data.type === 'rendered' && data.version === 4)).toBe(true)
  })
  act(() =>
    send({ type: 'board.tweaks.preview', boardId: 'reading', version: 4, values: { spacing: 30 } }),
  )
  const root = container.firstElementChild
  if (!(root instanceof HTMLElement)) throw new Error('打印画板未就绪')
  expect(root.style.width).toBe('816px')
  expect(root.style.minHeight).toBe('2440px')
  expect(root.style.backgroundColor).toBe('rgb(240, 240, 240)')
  expect(root.style.getPropertyValue('--akasha-tweak-spacing')).toBe('8')
  expect(root.textContent).toContain('作者正文')
  expect(root.textContent).toContain('页尾图层')
  expect(root.querySelectorAll('img')).toHaveLength(18)
  expect(root.querySelector('img[alt="17"]')?.getAttribute('src')).toBe(`${image}#17`)
  expect(root.querySelector('video')?.hasAttribute('autoplay')).toBe(false)
  act(() => send({ type: 'capture.print', version: 3, page: 0 }))
  expect(posted.at(-1)?.data).toMatchObject({ type: 'capture.print.failure', version: 3, page: 0 })
  act(() => send({ type: 'capture.print', version: 4, page: 1 }))
  await waitFor(() => {
    expect(posted.at(-1)?.data).toMatchObject({
      type: 'capture.print.failure',
      version: 4,
      page: 1,
    })
  })
})

it('按运行节点订阅作者样式，切版后不把同位置的新样式归给旧选区', async () => {
  const { bridge, posted, dispatchFromHost, nonce } = createMockBridgeHarness()
  render(
    <SandboxApp
      bridge={bridge}
      stateStore={new ArtifactStateStore()}
      preserved={new PreservedStateManager()}
    />,
  )
  const send = (message: object) =>
    act(() => dispatchFromHost({ v: PROTOCOL_VERSION, nonce, ...message }))
  const paint = (version: number, color: string) =>
    send({
      type: 'render',
      artifactType: 'html',
      version,
      state: {},
      source: `<main id="poster" style="color:${color}"><span style="letter-spacing:2px">标题</span></main>`,
    })
  const snapshot = () =>
    posted.map(({ data }) => data).findLast((entry) => entry.type === 'inspect.layers.snapshot')
  paint(1, 'red')
  send({ type: 'inspect.layers.watch', active: true })
  const first = await waitFor(() => {
    const id = snapshot()?.layers.find((entry) => entry.label === '标题')?.id
    if (!id) throw new Error('等待标题的运行节点')
    return id
  })
  expect(snapshot()?.styles).toBeUndefined()
  send({ type: 'inspect.layers.watch', active: true, styleLayerId: first })
  await waitFor(() =>
    expect(snapshot()?.styles).toMatchObject({
      layerId: first,
      declarations: expect.arrayContaining([
        expect.objectContaining({ property: 'letter-spacing', value: '2px', source: 'style' }),
        expect.objectContaining({
          property: 'color',
          value: 'red',
          inheritedFrom: expect.stringContaining('poster'),
        }),
      ]),
    }),
  )
  paint(2, 'blue')
  await waitFor(() => expect(snapshot()?.version).toBe(2))
  expect(snapshot()?.styles).toBeUndefined()
})
