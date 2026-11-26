// @vitest-environment jsdom
import type { ArtifactWorkspaceDetail } from '@akasha/protocol'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { artifact, detailFor, setupCanvasTest, showWorkspace } from './canvas-test-fixture'

setupCanvasTest()

class CursorSocket {
  static readonly OPEN = 1
  static readonly opened: CursorSocket[] = []
  readyState = 1
  send = vi.fn()
  close = vi.fn()
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  constructor(readonly url: string | URL) {
    CursorSocket.opened.push(this)
  }
  receive(data: object) {
    act(() =>
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ v: 1, ...data }) })),
    )
  }
}

it('把世界坐标投到自己的相机；切页、离线、播放和退出都不留下上一画布的光标', async () => {
  vi.stubGlobal('WebSocket', CursorSocket)
  vi.stubGlobal('PointerEvent', MouseEvent)
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  sessionStorage.setItem(
    `akasha:canvas:${artifact.publicId}/head`,
    JSON.stringify({
      pageId: 'reserve',
      pages: { reserve: { selected: null, camera: { x: 100, y: 200, scale: 0.5, fit: null } } },
    }),
  )
  const detail = { ...detailFor(), hubCanEditCanvas: true } satisfies ArtifactWorkspaceDetail
  const view = showWorkspace(detail)
  const socket = CursorSocket.opened.at(-1)
  if (!socket) throw new Error('头版本未连接 Hub 光标')
  const url = new URL(socket.url)
  expect([url.host, url.searchParams.get('artifactId'), url.searchParams.get('pageId')]).toEqual([
    window.location.host,
    artifact.publicId,
    'reserve',
  ])
  socket.receive({ type: 'cursor.ready' })
  const peerId = '3240141c-3629-46bf-a445-704239b2bfb7'
  const cursor = { type: 'cursor.moved', peerId, x: 640, y: 480, login: 'mei' }
  socket.receive(cursor)
  const marker = screen.getByRole('img', { name: '协作者光标：@mei' })
  expect([marker.style.left, marker.style.top]).toEqual(['420px', '440px'])
  const area = screen.getByRole('region', { name: '画布' })
  vi.spyOn(area, 'getBoundingClientRect').mockReturnValue(new DOMRect(30, 10, 2400, 2100))
  fireEvent.pointerMove(area, { clientX: 450, clientY: 450 })
  await waitFor(() =>
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ v: 1, type: 'cursor.move', x: 640, y: 480 }),
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  expect([marker.style.left, marker.style.top]).toEqual(['225px', '287.5px'])
  socket.receive({ type: 'cursor.left', peerId })
  expect(screen.queryByText('@mei')).toBeNull()
  socket.receive(cursor)
  act(() => socket.onclose?.(new CloseEvent('close', { code: 1006 })))
  expect(screen.queryByText('@mei')).toBeNull()
  await waitFor(() => expect(CursorSocket.opened.at(-1)).not.toBe(socket), { timeout: 2000 })
  const rejoined = CursorSocket.opened.at(-1)
  if (!rejoined) throw new Error('未重连')
  rejoined.receive({ type: 'cursor.ready' })
  expect(rejoined.send).not.toHaveBeenCalled()
  rejoined.receive(cursor)
  fireEvent.click(screen.getByRole('button', { name: '页面与画板' }))
  fireEvent.click(screen.getByRole('button', { name: '状态' }))
  expect(rejoined.close).toHaveBeenCalledOnce()
  expect(screen.queryByText('@mei')).toBeNull()
  const nextPage = CursorSocket.opened.at(-1)
  if (!nextPage) throw new Error('未切换光标页面')
  expect(new URL(nextPage.url).searchParams.get('pageId')).toBe('status')
  nextPage.receive({ type: 'cursor.ready' })
  nextPage.receive({ ...cursor, login: null })
  expect(screen.getByText('访客 3240')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开画板：预约完成' }))
  expect(nextPage.close).toHaveBeenCalledOnce()
  expect(screen.queryByText('访客 3240')).toBeNull()
  view.unmount()
})

it('本机、只读 Hub 和固定头版都不连接协作房间', () => {
  CursorSocket.opened.length = 0
  vi.stubGlobal('WebSocket', CursorSocket)
  const detail = { ...detailFor(), hubCanEditCanvas: true } satisfies ArtifactWorkspaceDetail
  const view = showWorkspace(detail)
  expect(CursorSocket.opened).toHaveLength(0)
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  view.update(
    <ArtifactWorkspace
      detail={{ ...detail, hubCanEditCanvas: false }}
      versions={[detail.version]}
      sandboxOrigin="http://127.0.0.1:24331"
    />,
  )
  expect(CursorSocket.opened).toHaveLength(0)
  view.update(
    <ArtifactWorkspace
      detail={detail}
      fixedVersion={1}
      versions={[detail.version]}
      sandboxOrigin="http://127.0.0.1:24331"
    />,
  )
  expect(CursorSocket.opened).toHaveLength(0)
})
