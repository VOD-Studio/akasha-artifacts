// @vitest-environment jsdom
import type { VersionSummary } from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CanvasDocument } from '../src/entities/artifact'
import { setLocale } from '../src/shared/i18n'
import type { CanvasBoardEditing } from '../src/widgets/ArtifactWorkspace/hooks/useCanvasBoardEditing'
import { ArtifactCanvas } from '../src/widgets/ArtifactWorkspace/ui/ArtifactCanvas'

const version: VersionSummary = {
  artifactId: 'CanvasExamplePublicId1',
  version: 1,
  parentVersion: null,
  author: 'agent:cli',
  title: '印刷样张',
  createdAt: '2026-11-22T09:00:00.000Z',
}
const canvas: CanvasDocument = {
  pages: [
    {
      id: 'proofs',
      title: '印刷样张',
      boards: [
        { id: 'proof', title: 'Poster', width: 400, height: 200, type: 'html', scoped: true },
      ],
    },
  ],
  columns: 1,
  flows: [],
  showFlows: false,
  handDrawnFlows: false,
}

function showCanvas(readOnly = false, document = canvas) {
  const change = vi.fn<CanvasBoardEditing['change']>().mockResolvedValue(true)
  const undo = vi.fn()
  const editing: CanvasBoardEditing = {
    version,
    change,
    undo,
    draft: null,
    inputError: '',
    busy: false,
    available: true,
    replaceSource: vi.fn(),
    dismissDraft: vi.fn(),
  }
  const onComment = vi.fn()
  render(
    <ArtifactCanvas
      document={document}
      visible
      storageKey="test-pen"
      address="#page=proofs"
      pageLink={(id) => `#page=${id}`}
      onRevealHandled={vi.fn()}
      onLocationChange={vi.fn()}
      onClearElement={vi.fn()}
      onComment={onComment}
      exportVersion={version}
      boardEditing={readOnly ? undefined : editing}
      renderBoard={(board) => <p>{board.title}</p>}
      onDemandChange={vi.fn()}
      canPlay={() => false}
      canAnimate={() => false}
    />,
  )
  return { change, undo, onComment }
}

beforeEach(() => {
  setLocale('zh-CN')
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('钢笔只记录点击的节点，切换语言保留草稿、焦点和物理坐标，Enter 仅提交一次', () => {
  const { change } = showCanvas()
  fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' })
  const surface = screen.getByRole('button', { name: '在Poster绘制折线' })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 200, 100))
  fireEvent.pointerDown(surface, { clientX: 20, clientY: 20 })
  fireEvent.pointerMove(surface, { clientX: 100, clientY: 100 })
  fireEvent.pointerUp(surface, { clientX: 120, clientY: 60 })
  act(() => setLocale('en'))
  expect(screen.getByRole('button', { name: 'Draw polyline on Poster' })).toBe(surface)
  expect(screen.getByRole('button', { name: 'Pen' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Fit page' }).getAttribute('aria-keyshortcuts')).toBe(
    'Shift+1',
  )
  act(() => setLocale('ar'))
  expect(screen.getByRole('button', { name: 'رسم خط متعدد المقاطع: Poster' })).toBe(surface)
  expect(document.activeElement).toBe(surface)
  expect(screen.getByRole('region', { name: 'مساحة الرسم' }).dir).toBe('ltr')
  expect(screen.getByRole('button', { name: 'Poster' }).closest('[dir]')?.getAttribute('dir')).toBe(
    'rtl',
  )
  fireEvent.pointerDown(surface, { clientX: 60, clientY: 80 })
  fireEvent.pointerDown(surface, { clientX: 160, clientY: 30 })
  expect(change).not.toHaveBeenCalled()
  fireEvent.keyDown(surface, { key: 'Enter' })
  expect(change).toHaveBeenCalledTimes(1)
  const [command, base] = change.mock.calls[0]
  expect(base).toBe(version)
  if (command.kind !== 'layerCreate' || command.layer.kind !== 'stroke') throw Error('未提交笔迹')
  const layer = command.layer
  expect(
    layer.points.map(([x, y]) => [
      Math.round(layer.x + x * layer.width),
      Math.round(layer.y + y * layer.height),
    ]),
  ).toEqual([
    [20, 20],
    [100, 140],
    [300, 40],
  ])
})

it('钢笔从铅笔旁的菜单打开，Esc 放弃，双击完成另一条折线', () => {
  const { change } = showCanvas()
  fireEvent.click(screen.getByRole('button', { name: '选择绘图工具' }))
  fireEvent.click(screen.getByRole('button', { name: '钢笔 (P)' }))
  const first = screen.getByRole('button', { name: '在Poster绘制折线' })
  vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 200))
  fireEvent.pointerDown(first, { clientX: 10, clientY: 30 })
  fireEvent.keyDown(first, { key: 'Escape' })
  expect(change).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: 'p' })
  const second = screen.getByRole('button', { name: '在Poster绘制折线' })
  vi.spyOn(second, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 200))
  fireEvent.pointerDown(second, { clientX: 40, clientY: 30 })
  fireEvent.pointerDown(second, { clientX: 70, clientY: 120 })
  fireEvent.doubleClick(second)
  expect(change).toHaveBeenCalledTimes(1)
})

it('画板设置输入中不拦截单字符、撤销或 IME，切换语言不清空几何草稿', () => {
  const { undo, onComment, change } = showCanvas()
  fireEvent.keyDown(document.body, { key: 'h' })
  expect(screen.getByRole('button', { name: '抓手' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: '设置画板：Poster' }))
  const input = screen.getByRole<HTMLInputElement>('spinbutton', { name: '宽度' })
  input.focus()
  fireEvent.change(input, { target: { value: '520' } })
  expect(fireEvent.keyDown(input, { key: 'G', shiftKey: true })).toBe(true)
  for (const key of ['v', 'p', 'c', 'f', ' ']) expect(fireEvent.keyDown(input, { key })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'z', ctrlKey: true })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'v', isComposing: true })).toBe(true)
  act(() => setLocale('de'))
  expect(screen.getByRole('spinbutton', { name: 'Breite' })).toBe(input)
  expect(input.value).toBe('520')
  expect(document.activeElement).toBe(input)
  expect(screen.getByRole('button', { name: 'Handwerkzeug' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(onComment).not.toHaveBeenCalled()
  expect(undo).not.toHaveBeenCalled()
  expect(change).not.toHaveBeenCalled()
})

it('只读画布保留浏览和批注快捷键，不显示也不能键盘唤起写工具', () => {
  const { onComment, change } = showCanvas(true)
  fireEvent.keyDown(document.body, { key: 'p' })
  fireEvent.keyDown(document.body, { key: 'f' })
  expect(screen.queryByRole('button', { name: '选择绘图工具' })).toBeNull()
  expect(screen.queryByRole('button', { name: '添加画板' })).toBeNull()
  expect(screen.queryByRole('button', { name: '在Poster绘制折线' })).toBeNull()
  expect(change).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: 'c' })
  expect(onComment).toHaveBeenCalledOnce()
})

it('辅助线在画板固有坐标内显示；缩放菜单和快捷键只切换单选画板，不写快照', () => {
  const board = canvas.pages[0].boards[0]
  const document: CanvasDocument = {
    ...canvas,
    pages: [
      {
        ...canvas.pages[0],
        boards: [
          { ...board, layoutGuides: [{ axis: 'x', position: 37 }] },
          { ...board, id: 'second', title: 'Letter', layoutGuides: [{ axis: 'y', position: 61 }] },
        ],
      },
    ],
  }
  const { change } = showCanvas(false, document)
  const poster = screen.getByRole('button', { name: 'Poster' })
  const letter = screen.getByRole('button', { name: 'Letter' })
  const guide = (title: HTMLElement) =>
    title.closest('.artifact-canvas-board')?.querySelector('svg[data-layout-guides]')
  const shortcut = { key: 'G', code: 'KeyG', shiftKey: true }
  expect(guide(poster)?.getAttribute('viewBox')).toBe('0 0 400 200')
  expect(guide(poster)?.querySelector('path')?.getAttribute('d')).toBe('M37 0V200')
  expect(guide(letter)?.querySelector('path')?.getAttribute('d')).toBe('M0 61H400')
  expect(fireEvent.keyDown(poster, shortcut)).toBe(true)
  fireEvent.click(poster)
  const zoom = screen.getByLabelText('画布缩放比例').textContent
  fireEvent.click(screen.getByRole('button', { name: '缩放选项' }))
  const toggle = screen.getByRole('button', { name: '显示画板辅助线' })
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  expect(fireEvent.keyDown(toggle, shortcut)).toBe(true)
  act(() => setLocale('en'))
  expect(screen.getByRole('button', { name: 'Show artboard guides' })).toBe(toggle)
  act(() => setLocale('de'))
  expect(screen.getByRole('button', { name: 'Hilfslinien der Zeichenfläche anzeigen' })).toBe(
    toggle,
  )
  act(() => setLocale('ar'))
  expect(screen.getByRole('button', { name: 'إظهار خطوط إرشاد لوحة الرسم' })).toBe(toggle)
  act(() => setLocale('zh-CN'))
  fireEvent.click(toggle)
  expect(guide(poster)).toBeNull()
  expect(guide(letter)).toBeTruthy()
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(zoom)
  fireEvent.click(letter)
  expect(fireEvent.keyDown(letter, shortcut)).toBe(false)
  expect(guide(letter)).toBeNull()
  fireEvent.click(poster, { shiftKey: true })
  expect(fireEvent.keyDown(poster, shortcut)).toBe(true)
  expect(guide(poster)).toBeNull()
  expect(guide(letter)).toBeNull()
  fireEvent.click(poster)
  fireEvent.keyDown(poster, shortcut)
  expect(guide(poster)).toBeTruthy()
  expect(guide(letter)).toBeNull()
  expect(change).not.toHaveBeenCalled()
  cleanup()
  showCanvas(true, document)
  const reopened = screen.getByRole('button', { name: 'Letter' })
  expect(guide(reopened)).toBeTruthy()
  fireEvent.click(reopened)
  fireEvent.keyDown(reopened, shortcut)
  expect(guide(reopened)).toBeNull()
})
