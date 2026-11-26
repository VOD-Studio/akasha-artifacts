// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import { detail, openWorkspace } from './workspace-shell-fixture'

const ARTBOARD_SPEC = {
  type: 'artboard',
  guide: 'artboard',
  whitelist: [],
  schema: {
    type: 'object',
    'x-akasha-props': [
      {
        key: 'showFlows',
        label: '显示页面流程连线',
        type: 'boolean',
        defaultValue: false,
      },
    ],
  },
}

describe('会话写权限前置检测', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView ??= vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useWorkspaceStore.setState({ inspectorTab: null, viewMode: 'preview', showComments: true })
  })

  it('本机无会话凭证时前置进入只读模式，隐藏编辑入口并禁用运行参数开关', async () => {
    const { responses } = openWorkspace(false, false)
    const endpoint = `/api/v1/artifacts/${detail.artifact.publicId}`
    const current = responses.get(endpoint) as Record<string, unknown>
    responses.set(endpoint, { ...current, canWrite: false, canComment: false })
    responses.set('/api/v1/specs/artboard', ARTBOARD_SPEC)

    const mutations: string[] = []
    const baseFetch = vi.mocked(fetch).getMockImplementation()
    if (!baseFetch) throw new Error('缺少工作台测试服务')
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method && init.method !== 'GET') mutations.push(`${init.method} ${String(input)}`)
      return baseFetch(input, init)
    })

    await screen.findByText('只读')
    expect(screen.queryByRole('button', { name: 'Agent 对话' })).toBeNull()
    expect(screen.queryByRole('button', { name: '添加画板' })).toBeNull()
    expect(screen.queryByRole('button', { name: '撤销画布编辑' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '画布批注' }).disabled).toBe(true)

    fireEvent.keyDown(screen.getByRole('button', { name: '作品菜单' }), { key: 'Enter' })
    expect(screen.queryByRole('menuitem', { name: '编辑代码' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '收藏' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const inspector = within(await screen.findByRole('dialog', { name: '检查器' }))
    expect(inspector.getByText('只读 · 缺少本机会话凭证，请通过 akasha open 打开')).toBeTruthy()
    expect(inspector.queryByRole('spinbutton', { name: '宽度' })).toBeNull()

    fireEvent.mouseDown(inspector.getByRole('tab', { name: '源码' }), { button: 0 })
    expect(inspector.queryByRole('button', { name: '编辑整份源码' })).toBeNull()

    const tweaksTab = await inspector.findByRole('tab', { name: '参数' })
    fireEvent.mouseDown(tweaksTab, { button: 0 })
    const flowSwitch = await inspector.findByRole<HTMLButtonElement>('switch', {
      name: '显示页面流程连线',
    })
    await waitFor(() => expect(flowSwitch.disabled).toBe(true))
    expect(mutations).toEqual([])
  })

  it('Hub 只读访客前置禁用参数修改，保留批注入口', async () => {
    const { responses } = openWorkspace(true, false)
    const endpoint = `/api/v1/artifacts/${detail.artifact.publicId}`
    const current = responses.get(endpoint) as Record<string, unknown>
    responses.set(endpoint, {
      ...current,
      hubCanEditCanvas: false,
      canWrite: false,
      canComment: true,
    })
    responses.set('/api/v1/specs/artboard', ARTBOARD_SPEC)

    await screen.findByText('只读')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '画布批注' }).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '检查器' }))
    const inspector = within(await screen.findByRole('dialog', { name: '检查器' }))
    expect(inspector.getByText('只读 · 无编辑权限')).toBeTruthy()

    const tweaksTab = await inspector.findByRole('tab', { name: '参数' })
    fireEvent.mouseDown(tweaksTab, { button: 0 })
    const flowSwitch = await inspector.findByRole<HTMLButtonElement>('switch', {
      name: '显示页面流程连线',
    })
    await waitFor(() => expect(flowSwitch.disabled).toBe(true))
  })
})
