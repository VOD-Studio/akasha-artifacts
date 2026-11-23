// @vitest-environment jsdom
import {
  DATA_POINT_SELECTION_LIMITS,
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  SandboxToShellMessageSchema,
} from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SandboxApp } from '../src/App'
import { SandboxBridgeClient } from '../src/bridge/client'
import { PreservedStateManager } from '../src/state/preserve'
import { ArtifactStateStore } from '../src/state/store'

afterEach(cleanup)

function setup() {
  const origin = 'https://shell.example.test'
  const nonce = 'decision-kits-test'
  const posted: SandboxToShellMessage[] = []
  const host = { postMessage: (message: SandboxToShellMessage) => posted.push(message) }
  const bridge = new SandboxBridgeClient({ expectedOrigin: origin, nonce, hostWindow: host })
  const preserved = new PreservedStateManager({ debounceMs: 0 })
  render(<SandboxApp bridge={bridge} preserved={preserved} stateStore={new ArtifactStateStore()} />)

  return {
    preserved,
    annotations: () => posted.filter((msg) => msg.type === 'annotation.request'),
    show(artifactType: 'pr-walkthrough' | 'data-story', source: object, version = 1) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            origin,
            source: host as unknown as MessageEventSource,
            data: {
              type: 'render',
              v: PROTOCOL_VERSION,
              nonce,
              state: {},
              artifactType,
              version,
              source: JSON.stringify(source),
            },
          }),
        )
      })
    },
  }
}

it('走查选中的章节跨版本保持，并排和统一使用相同的行批注锚点', () => {
  const app = setup()
  const overview = { id: 'intro', title: '总览', files: ['readme'] }
  const cache = { id: 'cache', title: '缓存策略', files: ['settings'] }
  const source = {
    chapters: [overview, cache],
    files: [
      { id: 'readme', path: 'README.md', diff: '@@ -1 +1 @@\n-old\n+new' },
      {
        id: 'settings',
        path: 'src/settings.ts',
        diff: '@@ -18,2 +18,3 @@\n const prefix = "cache"\n-const ttl = 10\n+const ttl = 30\n+const fallback = "<script>"',
      },
    ],
  }
  app.show('pr-walkthrough', source)
  fireEvent.click(screen.getByRole('button', { name: '缓存策略' }))
  expect(screen.getByText('src/settings.ts')).toBeTruthy()
  expect(screen.queryByText('README.md')).toBeNull()
  expect(screen.getByText('const fallback = "<script>"')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '批注 src/settings.ts 新版第 19 行' }))
  expect(app.annotations()).toMatchObject([
    {
      version: 1,
      element: {
        blockId: 'pr-line:settings:new:19',
        textPreview: 'src/settings.ts 新版第 19 行：const ttl = 30',
      },
    },
  ])
  fireEvent.click(screen.getByRole('button', { name: '并排' }))
  expect(screen.getByRole('button', { name: '并排' }).getAttribute('aria-pressed')).toBe('true')
  const added = screen.getByRole('button', { name: '批注 src/settings.ts 新版第 19 行' })
  const removed = screen.getByRole('button', { name: '批注 src/settings.ts 旧版第 19 行' })
  expect(added.closest('tr')).toBe(removed.closest('tr'))
  fireEvent.click(screen.getByRole('button', { name: '批注 src/settings.ts 新版第 19 行' }))
  expect(app.annotations()[1]?.element.blockId).toBe(app.annotations()[0]?.element.blockId)
  expect(app.preserved.getSnapshot().controls).toMatchObject({ 'pr-walkthrough.chapter': 'cache' })

  app.show('pr-walkthrough', { ...source, chapters: [{ ...overview, title: '新总览' }, cache] }, 2)
  expect(screen.getByRole('button', { name: '缓存策略' }).getAttribute('aria-current')).toBe('step')
  expect(screen.getByText('src/settings.ts')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '批注 src/settings.ts 旧版第 19 行' }))
  expect(app.annotations()[2]).toMatchObject({
    version: 2,
    element: { blockId: 'pr-line:settings:old:19' },
  })
})

it('数据故事同步筛选图表和表格，并将单点或多点的稳定引用送往反馈', () => {
  const app = setup()
  app.show('data-story', {
    datasets: [
      {
        id: 'delay',
        title: '接口耗时',
        filterBy: 'region',
        columns: [
          { id: 'region', label: '区域', kind: 'text' },
          { id: 'page', label: '页面', kind: 'text' },
          { id: 'ms', label: '耗时（毫秒）', kind: 'number' },
        ],
        rows: [
          { id: 'hz-home', values: { region: '杭州', page: '首页', ms: 120 } },
          { id: 'hz-cart', values: { region: '杭州', page: '购物车', ms: 188 } },
          { id: 'sh-profile', values: { region: '上海', page: '个人中心', ms: 149 } },
        ],
      },
    ],
    charts: [{ id: 'p95', title: 'P95 耗时', datasetId: 'delay', category: 'page', value: 'ms' }],
    tables: [{ id: 'raw', title: '耗时明细', datasetId: 'delay', columns: ['page', 'ms'] }],
  })
  const grid = screen.getByRole('table', { name: '耗时明细' })
  expect(within(grid).getByText('个人中心')).toBeTruthy()
  fireEvent.change(screen.getByRole('combobox', { name: '区域' }), {
    target: { value: 'filter:杭州' },
  })
  expect(within(grid).queryByText('个人中心')).toBeNull()
  expect(screen.queryByRole('button', { name: '个人中心：149' })).toBeNull()

  const home = screen.getByRole('button', { name: '首页：120' })
  fireEvent.click(home)
  expect(home.getAttribute('aria-pressed')).toBe('true')
  expect(app.annotations()).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '批注选中的 1 个数据点' }))
  expect(app.annotations()[0]).toMatchObject({
    element: { blockId: 'data-point:p95:delay:hz-home', textPreview: 'P95 耗时 · 首页：120' },
  })
  fireEvent.click(screen.getByRole('button', { name: '购物车：188' }), { shiftKey: true })
  fireEvent.click(screen.getByRole('button', { name: '批注选中的 2 个数据点' }))
  expect(app.annotations()[1]).toMatchObject({
    element: {
      blockId: 'data-points:p95:delay:hz-cart,hz-home',
      selector: '[data-ak-block="data-chart:p95:delay"]',
      textPreview: 'P95 耗时 · 首页：120；购物车：188',
      dataPoints: {
        chartId: 'p95',
        chartTitle: 'P95 耗时',
        datasetId: 'delay',
        valueLabel: '耗时（毫秒）',
        points: [
          { id: 'hz-home', label: '首页', value: 120 },
          { id: 'hz-cart', label: '购物车', value: 188 },
        ],
      },
    },
  })
  fireEvent.change(screen.getByRole('combobox', { name: '区域' }), {
    target: { value: 'filter:上海' },
  })
  expect(screen.queryByRole('button', { name: '批注选中的 2 个数据点' })).toBeNull()
  expect(screen.getByRole('button', { name: '个人中心：149' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  fireEvent.change(screen.getByRole('combobox', { name: '区域' }), {
    target: { value: 'filter:杭州' },
  })
  const plot = screen.getByRole('list', { name: '耗时（毫秒）' })
  for (const [index, name] of ['首页：120', '购物车：188'].entries()) {
    const button = within(plot).getByRole('button', { name })
    const bar = button.querySelector('[data-story-point]') ?? button
    bar.getBoundingClientRect = () => new DOMRect(50, 30 + index * 30, 45 + index * 20, 12)
  }
  const pointer = (type: string, clientX: number, clientY: number) =>
    fireEvent(
      plot,
      Object.assign(new MouseEvent(type, { bubbles: true, clientX, clientY }), {
        isPrimary: true,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    )
  pointer('pointerdown', 110, 52)
  pointer('pointermove', 160, 75)
  pointer('pointerup', 160, 75)
  expect(within(plot).getByRole('button', { name: '首页：120' }).getAttribute('aria-pressed')).toBe(
    'false',
  )
  fireEvent.click(screen.getByRole('button', { name: '批注选中的 1 个数据点' }))
  expect(app.annotations()[2]?.element.dataPoints?.points).toEqual([
    { id: 'hz-cart', label: '购物车', value: 188 },
  ])
})

it('反馈上下文保存超出预览长度的标签，并可见地阻止超限选区', () => {
  const app = setup()
  const prefix = '延迟采样'.repeat(50)
  const count = DATA_POINT_SELECTION_LIMITS.points
  app.show('data-story', {
    datasets: [
      {
        id: 'measurements',
        title: '采样',
        columns: [
          { id: 'label', label: '名称', kind: 'text' },
          { id: 'value', label: '读数', kind: 'number' },
        ],
        rows: Array.from({ length: count + 1 }, (_, i) => ({
          id: `r${i}`,
          values: { label: `${prefix} ${i}`, value: i },
        })),
      },
    ],
    charts: [
      {
        id: 'values',
        title: '观测值',
        datasetId: 'measurements',
        category: 'label',
        value: 'value',
      },
    ],
  })
  fireEvent.click(screen.getByRole('button', { name: `${prefix} 0：0` }))
  fireEvent.click(screen.getByRole('button', { name: `${prefix} ${count}：${count}` }), {
    shiftKey: true,
  })
  expect(screen.getByText(`每条批注最多包含 ${count} 个数据点。`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${prefix} ${count - 1}：${count - 1}` }), {
    shiftKey: true,
  })
  fireEvent.click(screen.getByRole('button', { name: `批注选中的 ${count} 个数据点` }))
  const parsed = SandboxToShellMessageSchema.parse(app.annotations()[0])
  expect(parsed).toMatchObject({
    type: 'annotation.request',
    element: {
      dataPoints: {
        points: Array.from({ length: count }, (_, i) => ({
          id: `r${i}`,
          label: `${prefix} ${i}`,
          value: i,
        })),
      },
    },
  })
})
