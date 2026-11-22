// @vitest-environment jsdom
import { type ArtifactSpecOutput, type JsonPatchOp, PROTOCOL_VERSION } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact/queries'
import { applyRealtimeEventToCache } from '../src/features/live-sync/useLiveSync'
import { buildPropPatch, PropsPanel } from '../src/features/props-panel/PropsPanel'
import type { ArtifactDetailResponse } from '../src/shared/api/client'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('apps/web L2 PropsPanel 结构化属性面板', () => {
  it('buildPropPatch 在 stateSnapshot 尚无 /props 时先初始化容器，已有时更新子路径', () => {
    expect(buildPropPatch({}, 'columns', 3)).toEqual([
      { op: 'add', path: '/props', value: { columns: 3 } },
    ])
    expect(buildPropPatch({ props: { columns: 2 } }, 'showFlows', false)).toEqual([
      { op: 'add', path: '/props/showFlows', value: false },
    ])
  })

  it('按 spec.schema 自动生成表单并在修改时推送 RFC 6902 状态补丁', async () => {
    const pushed: JsonPatchOp[][] = []
    const artboardSpec: ArtifactSpecOutput = {
      type: 'artboard',
      guide: 'artboard',
      whitelist: [],
      schema: {
        type: 'object',
        required: ['boards'],
        'x-akasha-props': [
          {
            key: 'columns',
            label: '每行画板列数',
            type: 'number',
            defaultValue: 2,
            min: 1,
            max: 4,
          },
          { key: 'showFlows', label: '显示页面流程连线', type: 'boolean', defaultValue: true },
          {
            key: 'density',
            label: '视图密度',
            type: 'select',
            defaultValue: 'comfortable',
            options: [
              { value: 'comfortable', label: '舒适' },
              { value: 'compact', label: '紧凑' },
            ],
          },
        ],
      },
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PropsPanel
          artifactId="AbCdEfGhIjKlMnOpQrStU"
          projectId="proj_1"
          artifactType="artboard"
          source={JSON.stringify({ boards: [], columns: 2, showFlows: true })}
          stateSnapshot={{}}
          specOverride={artboardSpec}
          onPushPatch={async (patch) => {
            pushed.push(patch)
          }}
        />
      </QueryClientProvider>,
    )

    const toggle = screen.getByLabelText('显示页面流程连线') as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)

    // 紧接着在首条请求返回前连续修改第二个控件：必须串行化并在第二条使用 /props/density，不得覆盖首条修改
    const select = screen.getByLabelText('视图密度') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'compact' } })

    await waitFor(() => expect(pushed).toHaveLength(2))
    expect(pushed[0]).toEqual([{ op: 'add', path: '/props', value: { showFlows: false } }])
    expect(pushed[1]).toEqual([{ op: 'add', path: '/props/density', value: 'compact' }])
  })

  it('applyRealtimeEventToCache 将 WS state.patched 增量合入详情状态快照，保持 L2 面板与 Agent 推送同步', () => {
    const qc = new QueryClient()
    const detail: ArtifactDetailResponse = {
      artifact: {
        publicId: 'AbCdEfGhIjKlMnOpQrStU',
        slug: 'artboard/demo',
        projectId: 'proj_1',
        title: 'Demo',
        type: 'artboard',
        visibility: 'private',
        headVersion: 1,
        createdAt: '2026-11-22T10:00:00.000Z',
        updatedAt: '2026-11-22T10:00:00.000Z',
      },
      version: {
        artifactId: 'AbCdEfGhIjKlMnOpQrStU',
        version: 1,
        parentVersion: null,
        author: 'agent:cli',
        title: 'Demo',
        source: '{"boards":[]}',
        createdAt: '2026-11-22T10:00:00.000Z',
      },
      state: {
        artifactId: 'AbCdEfGhIjKlMnOpQrStU',
        seq: 0,
        snapshot: {},
        updatedAt: '2026-11-22T10:00:00.000Z',
      },
      rounds: [],
    }
    qc.setQueryData(artifactKeys.detail('AbCdEfGhIjKlMnOpQrStU', undefined), detail)

    applyRealtimeEventToCache(qc, {
      v: PROTOCOL_VERSION,
      seq: 10,
      timestamp: '2026-11-22T10:05:00.000Z',
      type: 'state.patched',
      artifactId: 'AbCdEfGhIjKlMnOpQrStU',
      stateSeq: 1,
      ops: [{ op: 'add', path: '/props', value: { columns: 3 } }],
    })

    const updated = qc.getQueryData<ArtifactDetailResponse>(
      artifactKeys.detail('AbCdEfGhIjKlMnOpQrStU', undefined),
    )
    expect(updated?.state.seq).toBe(1)
    expect(updated?.state.snapshot).toEqual({ props: { columns: 3 } })
  })

  it('不含属性 Schema 的自由类型自动降级为 L1 并支持一键切回批注', () => {
    const onFallback = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <PropsPanel
          artifactId="AbCdEfGhIjKlMnOpQrStU"
          projectId="proj_1"
          artifactType="html"
          source="<div>freeform</div>"
          stateSnapshot={{}}
          specOverride={{ type: 'html', guide: 'html', whitelist: [] }}
          onFallbackToL1={onFallback}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('props-panel-l1-fallback')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '返回 L1 批注' }))
    expect(onFallback).toHaveBeenCalledTimes(1)
  })
})
