// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import { setLocale } from '../src/shared/i18n'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import {
  design,
  detailFor,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('打印版式和本板辅助线一次发布，撤销不影响另一张画板', async () => {
  stubResizeObserver()
  const editor = showEditableWorkspace(detailFor())
  fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
  act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
  const panel = within(screen.getByRole('dialog', { name: '检查器' }))
  fireEvent.click(panel.getByText('打印与辅助线'))
  expect(panel.queryByRole('radio', { name: 'A4' })).toBeNull()
  fireEvent.click(panel.getByRole('radio', { name: '流式' }))
  fireEvent.click(panel.getByRole('radio', { name: 'Letter' }))
  fireEvent.change(panel.getByRole('spinbutton', { name: '位置（px）' }), {
    target: { value: '120' },
  })
  fireEvent.click(panel.getByRole('button', { name: '添加辅助线' }))
  expect(editor.current.version.version).toBe(1)
  fireEvent.click(panel.getByRole('button', { name: '保存打印设置' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const saved = JSON.parse(editor.current.version.source)
  expect(saved.boards[0]).toMatchObject({
    printLayout: { mode: 'flow', paper: 'letter' },
    layoutGuides: [{ axis: 'x', position: 120 }],
  })
  expect(saved.boards[1]).toEqual(design.boards[1])
  fireEvent.click(screen.getByRole('button', { name: '撤销画布编辑' }))
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(JSON.parse(editor.current.version.source).boards).toEqual(design.boards)
})

it('英文打印草稿不覆盖新版：重新载入后显示该板的新纸型和辅助线', () => {
  stubResizeObserver()
  const sourceWithGuide = (position: number) =>
    JSON.stringify({
      ...design,
      boards: design.boards.map((board) =>
        board.id === 'desktop'
          ? {
              ...board,
              printLayout: { mode: 'flow', paper: 'letter' },
              layoutGuides: [{ axis: 'y', position }],
            }
          : board,
      ),
    })
  setLocale('en')
  try {
    const editor = showEditableWorkspace(detailFor(1, sourceWithGuide(24)))
    fireEvent.click(screen.getByRole('button', { name: '宽屏首页' }))
    act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
    fireEvent.click(screen.getByText('Print and guides'))
    const form = within(screen.getByRole('form', { name: 'Print and guides' }))
    fireEvent.click(form.getByRole('button', { name: 'Remove guide: Horizontal · 24 px' }))
    fireEvent.click(form.getByRole('radio', { name: 'A4' }))
    editor.receiveAgentSource(sourceWithGuide(48))
    const save = form.getByRole('button', { name: 'Save print settings' })
    expect(save).toHaveProperty('disabled', true)
    fireEvent.click(save)
    expect(editor.submittedVersion).toBeUndefined()
    fireEvent.click(form.getByRole('button', { name: 'Load current settings' }))
    expect(form.getByRole('radio', { name: 'Letter' })).toHaveProperty('checked', true)
    expect(form.getByText('Horizontal · 48 px')).toBeTruthy()
  } finally {
    act(() => setLocale('zh-CN'))
  }
})

it('英文用户调整旧稿的打印版式时，说明要修正的视口，不提交损坏快照', async () => {
  stubResizeObserver()
  setLocale('en')
  try {
    const editor = showEditableWorkspace(
      detailFor(
        1,
        JSON.stringify({
          boards: [{ id: 'old', title: 'Legacy board', viewport: { width: 0, height: 800 } }],
        }),
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Legacy board' }))
    act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
    fireEvent.click(screen.getByText('Print and guides'))
    const form = within(screen.getByRole('form', { name: 'Print and guides' }))
    fireEvent.click(form.getByRole('radio', { name: 'Flow' }))
    fireEvent.click(form.getByRole('button', { name: 'Save print settings' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Correct the artboard viewport width and height first',
    )
    expect(editor.submittedVersion).toBeUndefined()
  } finally {
    act(() => setLocale('zh-CN'))
  }
})

it.each(['固定版本', '只读分享'] as const)(
  '%s 能查看已有打印设置，不能保存或删除辅助线',
  (entry) => {
    stubResizeObserver()
    const detail = detailFor(
      1,
      JSON.stringify({
        boards: [
          {
            id: 'proof',
            title: '校样',
            printLayout: { mode: 'flow', paper: 'letter' },
            layoutGuides: [{ axis: 'x', position: 0 }],
          },
        ],
      }),
    )
    const view = showWorkspace(detail)
    view.update(
      <ArtifactWorkspace
        detail={
          entry === '只读分享'
            ? { ...detail, access: { role: 'view', expiresAt: '2099-01-01T00:00:00Z' } }
            : detail
        }
        versions={[detail.version]}
        fixedVersion={entry === '固定版本' ? 1 : undefined}
        sandboxOrigin="http://127.0.0.1:24331"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '校样' }))
    act(() => useWorkspaceStore.getState().setInspectorTab('inspect'))
    const panel = within(screen.getByRole('dialog', { name: '检查器' }))
    fireEvent.click(panel.getByText('打印与辅助线'))
    expect(panel.getByText('Letter')).toBeTruthy()
    expect(panel.getByText('垂直 · 0 px')).toBeTruthy()
    expect(panel.queryByRole('button', { name: '保存打印设置' })).toBeNull()
    expect(panel.queryByRole('button', { name: /删除辅助线/ })).toBeNull()
  },
)
