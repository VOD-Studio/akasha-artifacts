// @vitest-environment jsdom
import { expect, it, onTestFinished } from 'vitest'
import { offlinePage } from '../src/features/export-design/offline/offline-preview'

it('仅当前隔离帧能沿自身声明的流程跳转；已离开画板的消息失效', () => {
  const boards = ['a', 'b', 'c'].map((id) => ({ id, title: id, width: 320, height: 240 }))
  const data = JSON.stringify({
    title: '作品',
    version: 1,
    pages: [{ id: 'p', title: '页面', boardIds: ['a', 'b', 'c'] }],
    boards,
    flows: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  })
  const shell = document.createElement('iframe')
  document.body.append(shell)
  onTestFinished(() => shell.remove())
  const doc = shell.contentDocument
  const host = shell.contentWindow
  if (!doc || !host) throw new Error('未创建离线预览窗口')
  doc.open()
  const framesScript = 'const offlineFrames = {frameStart:"<pre>",frameEnd:"</pre>"}'
  doc.write(offlinePage(data, framesScript, 'en'))
  doc.close()

  const picker = doc.querySelector<HTMLSelectElement>('#board')
  const first = doc.querySelector('iframe')?.contentWindow
  if (!picker || !first) throw new Error('未打开第一张画板')
  const send = (source: Window | null, origin: string, target: string) => {
    const data = { type: 'akasha.offline.navigate', target }
    host.dispatchEvent(new MessageEvent('message', { source, origin, data }))
  }
  send(null, 'null', 'b')
  send(window, 'null', 'b')
  send(first, 'https://example.org', 'b')
  send(first, 'null', 'c')
  expect(picker.value).toBe('a')
  send(first, 'null', 'b')
  expect(picker.value).toBe('b')
  send(first, 'null', 'c')
  expect(picker.value).toBe('b')
  const second = doc.querySelector('iframe')?.contentWindow
  if (!second) throw new Error('未打开第二张画板')
  send(second, 'null', 'c')
  expect(picker.value).toBe('c')
})
