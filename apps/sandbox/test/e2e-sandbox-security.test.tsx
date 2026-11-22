// @vitest-environment jsdom
import {
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  type ShellToSandboxMessage,
} from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SandboxApp } from '../src/App'
import { SandboxBridgeClient } from '../src/bridge/client'
import { PreservedStateManager } from '../src/state/preserve'
import { ArtifactStateStore } from '../src/state/store'

declare global {
  var __AK_E2E_MOUNT_COUNT__: number | undefined
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  globalThis.__AK_E2E_MOUNT_COUNT__ = undefined
})

describe('沙盒端到端回归（100 次 StateStream 零重挂、热更新保态与 XSS/Bridge 隔离）', () => {
  it('React 沙盒连续推送 100 次 state 补丁零重挂，HTML 更新重绘保留滚动位置与滑块值，并拦截危险脚本与伪造消息', async () => {
    const shellOrigin = 'http://127.0.0.1:24321'
    const nonce = 'e2e-sandbox-nonce-1'
    const posted: SandboxToShellMessage[] = []
    const hostWindow = {
      postMessage: (data: unknown) => {
        posted.push(data as SandboxToShellMessage)
      },
    }
    const bridge = new SandboxBridgeClient({
      expectedOrigin: shellOrigin,
      nonce,
      hostWindow,
      listenTarget: window,
    })
    const stateStore = new ArtifactStateStore()
    const preserved = new PreservedStateManager({ debounceMs: 0 })

    const dispatch = (msg: ShellToSandboxMessage, opts?: { origin?: string; source?: unknown }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: msg,
          origin: opts?.origin ?? shellOrigin,
          source: (opts && 'source' in opts ? opts.source : hostWindow) as MessageEventSource,
        }),
      )
    }

    const { container } = render(
      <SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />,
    )

    // 1. 伪造 origin 的 render 消息必须被沙盒 Bridge 丢弃
    act(() => {
      dispatch(
        {
          v: PROTOCOL_VERSION,
          nonce,
          type: 'render',
          artifactType: 'html',
          version: 1,
          source: '<div>forged-origin-should-not-render</div>',
          state: {},
        },
        { origin: 'https://evil.example' },
      )
    })
    expect(screen.queryByText('forged-origin-should-not-render')).toBeNull()

    // 2. React 组件渲染 + 连续 100 次 StateStream 增量补丁（mountCount 必须恒为 1）
    const reactSource = `
      import { useEffect } from 'react'
      import { useArtifactState } from '@akasha/runtime'
      export default function LiveCounter() {
        const state = useArtifactState()
        useEffect(() => {
          globalThis.__AK_E2E_MOUNT_COUNT__ = (globalThis.__AK_E2E_MOUNT_COUNT__ ?? 0) + 1
        }, [])
        return <div data-testid="e2e-counter">count:{state.count}</div>
      }
    `
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'react',
        version: 1,
        source: reactSource,
        state: { count: 0 },
      })
    })
    await waitFor(() => expect(screen.getByTestId('e2e-counter').textContent).toBe('count:0'))
    expect(globalThis.__AK_E2E_MOUNT_COUNT__).toBe(1)

    act(() => {
      for (let seq = 1; seq <= 100; seq++) {
        dispatch({
          v: PROTOCOL_VERSION,
          nonce,
          type: 'state',
          seq,
          ops: [{ op: 'replace', path: '/count', value: seq }],
        })
      }
    })
    await waitFor(() => expect(screen.getByTestId('e2e-counter').textContent).toBe('count:100'))
    expect(globalThis.__AK_E2E_MOUNT_COUNT__).toBe(1)

    // 3. HTML v1 -> v2 重绘保留滚动位置与 data-ak-persist 滑块控件值
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 2,
        source:
          '<div data-ak-id="panel"><input aria-label="zoom" type="range" data-ak-persist="zoom" min="0" max="100" value="25" /></div>',
        state: {},
      })
    })
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const slider = (await screen.findByLabelText('zoom')) as HTMLInputElement
    fireEvent.input(slider, { target: { value: '82' } })
    preserved.setScroll(0, 180)
    preserved.flush()

    const lastSnapshot = [...posted]
      .reverse()
      .find(
        (m): m is Extract<SandboxToShellMessage, { type: 'viewState.snapshot' }> =>
          m.type === 'viewState.snapshot',
      )
    expect(lastSnapshot?.state.controls?.zoom).toBe(82)
    expect(lastSnapshot?.state.scrollY).toBe(180)

    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'html',
        version: 3,
        source:
          '<div data-ak-id="panel"><p>v3 updated</p><input aria-label="zoom" type="range" data-ak-persist="zoom" min="0" max="100" value="25" /></div>',
        state: {},
        preservedState: lastSnapshot?.state,
      })
    })
    await waitFor(() => expect(screen.getByText('v3 updated')).toBeTruthy())
    expect((screen.getByLabelText('zoom') as HTMLInputElement).value).toBe('82')
    expect(scrollToSpy).toHaveBeenCalledWith(0, 180)

    // 4. SVG 内联脚本与事件处理器被剥离
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'svg',
        version: 4,
        source:
          '<svg viewBox="0 0 20 20"><script>alert(1)</script><rect onload="alert(2)" width="10" height="10" /></svg>',
        state: {},
      })
    })
    await waitFor(() => expect(container.querySelector('svg rect')).toBeTruthy())
    expect(container.querySelector('svg script')).toBeNull()
    expect(container.querySelector('svg rect')?.getAttribute('onload')).toBeNull()
  })
})
