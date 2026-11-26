// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../src/entities/workspace'
import {
  detailFor,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('离开画布不发布文字：在原快照恢复到原画板，其他版本和只读访客不显示草稿', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const detail = detailFor()
  const first = showWorkspace(detail)
  fireEvent.click(screen.getByRole('button', { name: '添加文本' }))
  const board = screen.getByRole('button', { name: '在手机首页添加文本' })
  vi.spyOn(board, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 390, 844))
  const point = { button: 0, clientX: 48, clientY: 64 }
  fireEvent.pointerDown(board, point)
  fireEvent.pointerUp(board, point)
  const text = '只在确认后发布的文字'
  fireEvent.change(screen.getByRole('textbox', { name: '文字' }), { target: { value: text } })
  act(() => useWorkspaceStore.getState().setViewMode('source'))
  expect(screen.queryByRole('textbox', { name: '文字' })).toBeNull()
  act(() => useWorkspaceStore.getState().setViewMode('preview'))
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '文字' }).value).toBe(text)
  first.unmount()

  const other = showWorkspace(detailFor(2))
  expect(screen.queryByRole('textbox', { name: '文字' })).toBeNull()
  other.unmount()
  const guest = showWorkspace({
    ...detail,
    access: { role: 'view', expiresAt: '2099-01-01T00:00:00Z' },
  })
  expect(screen.queryByRole('textbox', { name: '文字' })).toBeNull()
  guest.unmount()

  const editor = showEditableWorkspace(detail)
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '文字' }).value).toBe(text)
  expect(editor.submittedVersion).toBeUndefined()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const boards = JSON.parse(editor.current.version.source).boards
  expect(boards[0].designLayers).toBeUndefined()
  expect(boards[1]).toMatchObject({
    id: 'mobile',
    designLayers: [{ kind: 'text', text, x: 48, y: 64 }],
  })
})
