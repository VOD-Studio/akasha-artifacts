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

function setupSandbox() {
  const shellOrigin = 'http://127.0.0.1:24321'
  const nonce = 'kit-test-nonce'
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

  const dispatch = (msg: ShellToSandboxMessage) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: msg,
        origin: shellOrigin,
        source: hostWindow as unknown as MessageEventSource,
      }),
    )
  }

  return { bridge, stateStore, preserved, posted, dispatch, nonce }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('apps/sandbox Kit 工程与决策模板渲染器', () => {
  it('live-timeline 与 option-compare 渲染结构化内容并响应 StateStream 实时更新', async () => {
    const { bridge, stateStore, preserved, dispatch, nonce } = setupSandbox()
    const { container } = render(
      <SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />,
    )

    // 1. live-timeline 渲染与 StateStream 实时推进步骤状态
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'live-timeline',
        version: 1,
        source: JSON.stringify({
          title: 'CI 排障流水线',
          steps: [
            { id: 'lint', title: '静态检查', status: 'done', durationMs: 420 },
            { id: 'test', title: '运行测试', status: 'pending' },
          ],
        }),
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('CI 排障流水线')).toBeTruthy())
    expect(container.querySelector('[data-ak-block="test"]')?.textContent).toContain('待执行')

    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'state',
        seq: 1,
        ops: [
          {
            op: 'add',
            path: '/stepOverrides',
            value: { test: { status: 'done', output: '68 passed' } },
          },
        ],
      })
    })
    await waitFor(() => expect(screen.getByText('68 passed')).toBeTruthy())
    expect(container.querySelector('[data-ak-block="test"]')?.textContent).toContain('已完成')

    // 2. option-compare 渲染对比矩阵并响应 L2 props 补丁
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'option-compare',
        version: 2,
        source: JSON.stringify({
          title: '缓存方案对比',
          recommended: 'redis',
          dimensions: [{ id: 'latency', label: '延迟' }],
          options: [
            { id: 'redis', title: 'Redis', pros: ['低延迟'], values: { latency: '<1ms' } },
            { id: 'pg', title: 'Postgres', cons: ['吞吐略低'], values: { latency: '5ms' } },
          ],
        }),
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('缓存方案对比')).toBeTruthy())
    expect(screen.getByText('推荐')).toBeTruthy()
    expect(screen.getByText('<1ms')).toBeTruthy()
  })

  it('artboard、document 与 verify 完整渲染并支持页面切换、HTML 净化、行内提问与可展开验收证据', async () => {
    const { bridge, stateStore, preserved, dispatch, nonce } = setupSandbox()
    const { container } = render(
      <SandboxApp bridge={bridge} stateStore={stateStore} preserved={preserved} />,
    )

    // 1. artboard 并排多画板 + 推荐标记 + 页面切换 + 流程连线 + 恶意脚本净化
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'artboard',
        version: 1,
        source: JSON.stringify({
          title: '结账页多方案',
          pages: [
            { id: 'desktop', title: '桌面端' },
            { id: 'mobile', title: '移动端' },
          ],
          boards: [
            {
              id: 'b-a',
              title: '方案 A',
              pageId: 'desktop',
              html: '<div>桌面布局 A</div><script>window.evil=1</script>',
            },
            {
              id: 'b-b',
              title: '方案 B',
              pageId: 'desktop',
              recommended: true,
              html: '<div>桌面布局 B</div>',
            },
            {
              id: 'b-m',
              title: '移动精简版',
              pageId: 'mobile',
              html: '<div>移动布局</div>',
            },
          ],
          flows: [{ from: 'b-a', to: 'b-b', label: '推荐演进' }],
        }),
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('桌面布局 A')).toBeTruthy())
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getByText('推荐方案')).toBeTruthy()
    expect(screen.getByText('推荐演进')).toBeTruthy()
    expect(container.querySelector('[data-ak-block="b-b"]')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '移动端' }))
    await waitFor(() => expect(screen.getByText('移动布局')).toBeTruthy())

    // 2. document 先渲染 HTML 再切换为 JSON 结构化文档：必须彻底销毁旧 HTML 节点，不得残留旧 DOM 与旧锚点
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'document',
        version: 2,
        source: '<p id="legacy-html-block">旧版 HTML 段落残留检测</p>',
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('旧版 HTML 段落残留检测')).toBeTruthy())

    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'document',
        version: 3,
        source: JSON.stringify({
          title: '限流策略设计稿',
          sections: [
            {
              id: 'sec-1',
              heading: '核心配额',
              paragraphs: [{ id: 'p-1', text: '单用户每秒 10 次请求。' }],
              questions: [{ id: 'q-1', prompt: '是否需要突发令牌桶？', status: 'open' }],
            },
          ],
        }),
        state: {
          edits: { 'p-1': '单用户每秒 20 次请求（含突发桶）。' },
        },
      })
    })
    await waitFor(() => expect(screen.getByText('限流策略设计稿')).toBeTruthy())
    expect(screen.queryByText('旧版 HTML 段落残留检测')).toBeNull()
    expect(container.querySelector('#legacy-html-block')).toBeNull()
    expect(screen.getByText('人工已改稿')).toBeTruthy()
    expect(screen.getByText('单用户每秒 20 次请求（含突发桶）。')).toBeTruthy()
    expect(screen.getByText('是否需要突发令牌桶？')).toBeTruthy()
    expect(container.querySelector('[data-ak-block="p-1"]')).toBeTruthy()

    // 3. verify 预期/实际对比 + 展开原始证据 + 未验证项 + StateStream 驳回重验更新
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'render',
        artifactType: 'verify',
        version: 4,
        source: JSON.stringify({
          title: 'M3 交付验收',
          screens: [
            {
              id: 'scr-1',
              title: '画布对比',
              expectedHtml: '<div>预期界面</div>',
              actualHtml: '<div>实际界面</div>',
            },
          ],
          claims: [
            {
              id: 'c-1',
              title: '沙盒隔离安全回归',
              status: 'failed',
              command: 'make test',
              evidence: '1 failed',
              verdict: 'reject',
            },
          ],
          unverified: [{ id: 'u-1', title: '线上压测', reason: '尚未部署', risk: 'medium' }],
        }),
        state: {},
      })
    })
    await waitFor(() => expect(screen.getByText('预期界面')).toBeTruthy())
    expect(screen.getByText('实际界面')).toBeTruthy()
    expect(screen.getByText('未验证项清单（1）')).toBeTruthy()

    // 展开原始输出证据
    fireEvent.click(screen.getByRole('button', { name: '展开原始证据' }))
    expect(screen.getByTestId('verify-evidence-c-1').textContent).toContain('1 failed')

    // 被驳回项修复后通过 StateStream 更新证据并标为待重验
    act(() => {
      dispatch({
        v: PROTOCOL_VERSION,
        nonce,
        type: 'state',
        seq: 2,
        ops: [
          {
            op: 'add',
            path: '/claimOverrides',
            value: { 'c-1': { status: 'updated', evidence: '68 passed (0 failed)' } },
          },
        ],
      })
    })
    await waitFor(() =>
      expect(screen.getByTestId('verify-evidence-c-1').textContent).toContain('68 passed'),
    )
    expect(screen.getByText('已修复待重验')).toBeTruthy()
  })
})
