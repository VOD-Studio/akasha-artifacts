// @vitest-environment jsdom
import type { ArtboardContent } from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CanvasBoard, CanvasPage } from '../src/entities/artifact'
import { LanguageMenu, setLocale } from '../src/shared/i18n'
import { BoardPresentation } from '../src/widgets/ArtifactWorkspace/BoardPresentation'
import { BoardResourceView } from '../src/widgets/ArtifactWorkspace/BoardResourceView'
import { BoardResources } from '../src/widgets/ArtifactWorkspace/board-resources'
import { PageNavigator } from '../src/widgets/ArtifactWorkspace/PageNavigator'

const first: CanvasBoard = {
  id: 'a',
  title: 'A',
  width: 300,
  height: 200,
  type: 'html',
  scoped: true,
}
const second: CanvasBoard = { ...first, id: 'b', title: 'B' }
const named: CanvasPage = {
  id: 'named',
  title: '未分组',
  boards: [first, second],
  ownedBoardCount: 2,
}
const virtual: CanvasPage = { id: '', title: '未分组', boards: [] }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setLocale('zh-CN')
})

function Navigator({ onNavigate }: { onNavigate: (page: CanvasPage, boardId?: string) => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('')
  return (
    <PageNavigator
      open={open}
      onOpenChange={setOpen}
      pages={[named, virtual]}
      page={named}
      selected="a"
      pageLink={(id) => `/?page=${id}`}
      onNavigate={onNavigate}
      status={status}
      onStatus={setStatus}
    />
  )
}

it('切换语言保留检索、选中画板和搜索焦点；只翻译同名的合成页面', () => {
  setLocale('en')
  const navigate = vi.fn()
  render(<Navigator onNavigate={navigate} />)
  const trigger = screen.getByRole('button', { name: 'Pages and artboards' })
  fireEvent.click(trigger)
  expect(screen.getByRole('group', { name: 'Ungrouped' })).toBeTruthy()
  expect(
    within(screen.getByRole('group', { name: '未分组' })).getByText('2 artboards'),
  ).toBeTruthy()
  const search = screen.getByRole('searchbox', { name: 'Search pages or artboards' })
  search.focus()
  fireEvent.change(search, { target: { value: 'A' } })
  act(() => setLocale('ar'))
  expect(screen.getByRole('searchbox', { name: 'البحث عن صفحات أو لوحات رسم' })).toBe(search)
  expect(document.activeElement).toBe(search)
  expect(search).toHaveProperty('value', 'A')
  const group = within(screen.getByRole('group', { name: '未分组' }))
  expect(group.getByText('لوحتا رسم')).toBeTruthy()
  expect(group.getByRole('button', { name: 'A', pressed: true })).toBeTruthy()
  expect(group.queryByRole('button', { name: 'B' })).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})

it.each(['keyboard', 'pointer'])(
  '通过 %s 在语言菜单切换，保留页导航搜索和正确的焦点落点',
  async (method) => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    setLocale('en')
    render(
      <>
        <LanguageMenu />
        <Navigator onNavigate={vi.fn()} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Pages and artboards' }))
    const search = screen.getByRole('searchbox', { name: 'Search pages or artboards' })
    search.focus()
    fireEvent.change(search, { target: { value: 'A' } })
    const language = screen.getByRole('button', { name: 'Interface language' })
    if (method === 'keyboard') {
      language.focus()
      fireEvent.keyDown(language, { key: 'ArrowDown' })
    } else {
      fireEvent.pointerDown(language, { button: 0 })
    }
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deutsch' }))
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Seiten oder Zeichenflächen suchen' })).toBe(
        search,
      ),
    )
    expect(search).toHaveProperty('value', 'A')
    expect(screen.getByRole('button', { name: 'A', pressed: true })).toBeTruthy()
    await waitFor(() =>
      expect(document.activeElement).toBe(method === 'keyboard' ? language : search),
    )
  },
)

it('菜单打开时切换为阿拉伯语，Escape 仍逐层返回原触发器', async () => {
  setLocale('de')
  render(<Navigator onNavigate={vi.fn()} />)
  const trigger = screen.getByRole('button', { name: 'Seiten und Zeichenflächen' })
  fireEvent.click(trigger)
  const more = screen.getByRole('button', { name: 'Weitere Seitenaktionen: 未分组' })
  fireEvent.keyDown(more, { key: 'ArrowDown' })
  const item = screen.getByRole('menuitem', { name: 'Seitenlink kopieren' })
  await waitFor(() => expect(document.activeElement).toBe(item))
  act(() => setLocale('ar'))
  expect(screen.getByRole('menuitem', { name: 'نسخ رابط الصفحة' })).toBe(item)
  expect(document.activeElement).toBe(item)
  fireEvent.keyDown(item, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(more))
  fireEvent.keyDown(more, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(trigger))
})

it('失败画板单独重试，语言切换不清空同级内容或让焦点离开重试画板', async () => {
  setLocale('ar')
  const retry = Promise.withResolvers<ArtboardContent>()
  const load = vi
    .fn<(id: string, signal: AbortSignal) => Promise<ArtboardContent>>()
    .mockRejectedValueOnce(new Error('HTTP 502'))
    .mockResolvedValueOnce({ id: 'b', html: 'B — محتوى' })
    .mockReturnValueOnce(retry.promise)
  const resources = new BoardResources(load)
  try {
    resources.setDemand(['a', 'b'], false)
    render(
      <>
        {[first, second].map((board) => (
          <BoardResourceView
            key={board.id}
            board={board}
            resources={resources}
            detailed
            render={(loaded) => <pre dir="ltr">{loaded.source}</pre>}
          />
        ))}
      </>,
    )
    const retryButton = await screen.findByRole('button', { name: 'إعادة محاولة تحميل لوحة الرسم' })
    const healthy = screen.getByText('B — محتوى')
    retryButton.focus()
    act(() => setLocale('en'))
    expect(screen.getByRole('alert').textContent).toContain('Could not load the artboard: HTTP 502')
    expect(screen.getByRole('button', { name: 'Retry loading artboard' })).toBe(retryButton)
    expect(document.activeElement).toBe(retryButton)
    fireEvent.click(retryButton)
    const region = screen.getByRole('group', { name: 'Artboard content: A' })
    expect(within(region).getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(region)
    await act(async () => retry.resolve({ id: 'a', html: 'A — محتوى' }))
    expect(within(region).getByText('A — محتوى')).toBeTruthy()
    expect(document.activeElement).toBe(region)
    expect(screen.getByText('B — محتوى')).toBe(healthy)
    expect(load.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'a'])
  } finally {
    resources.reset()
  }
})

it('单板查看随语言切换工具栏方向与缩放数字，不重置倍率或镜像作者画面', () => {
  setLocale('en')
  const play = vi.fn()
  render(
    <BoardPresentation board={first} onClose={vi.fn()} onPlay={play}>
      <div lang="en">Original artwork</div>
    </BoardPresentation>,
  )
  const panel = screen.getByRole('region', { name: 'Artboard view' })
  const content = within(panel).getByRole('region', { name: 'Artboard content' })
  const zoomIn = within(panel).getByRole('button', { name: 'Zoom in' })
  zoomIn.focus()
  fireEvent.click(zoomIn)
  expect(within(panel).getByLabelText('Artboard zoom level').textContent).toBe('125%')
  const artwork = within(content).getByText('Original artwork')
  act(() => setLocale('ar'))
  expect(screen.getByRole('region', { name: 'عرض لوحة الرسم' })).toBe(panel)
  expect(panel.dir).toBe('rtl')
  expect(content.dir).toBe('ltr')
  expect(within(content).getByText('Original artwork')).toBe(artwork)
  expect(within(panel).getByLabelText('نسبة تكبير لوحة الرسم').textContent).toContain('١٢٥')
  expect(document.activeElement).toBe(zoomIn)
  fireEvent.click(within(panel).getByRole('button', { name: 'تشغيل النموذج الأولي: A' }))
  expect(play).toHaveBeenCalledTimes(1)
})
