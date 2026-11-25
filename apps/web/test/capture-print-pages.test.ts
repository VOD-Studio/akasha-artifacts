// @vitest-environment jsdom
import { PROTOCOL_VERSION, ShellToSandboxMessageSchema } from '@akasha/protocol'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { captureBoardPrintPages } from '../src/shared/bridge/capture-png'

const board = {
  id: 'report',
  scoped: true,
  type: 'html',
  source: '<main>报告</main>',
  width: 600,
  height: 320,
  printLayout: { mode: 'flow', paper: 'a4' },
  layoutGuides: [{ axis: 'x', position: 50 }],
} as const
const a4 =
  'iVBORw0KGgoAAAANSUhEUgAAAxoAAARjAQAAAADAsW94AAAAhUlEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAcwO7HgABlttZ5QAAAABJRU5ErkJggg=='
const letter =
  'iVBORw0KGgoAAAANSUhEUgAAAzAAAAQgAQAAAAARAoSjAAAAgElEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHg0qO8AAUsZVcMAAAAASUVORK5CYII='
let locked = false

function readBlob(this: Blob) {
  const reader = new FileReader()
  const result = Promise.withResolvers<ArrayBuffer>()
  reader.onload = () => {
    if (reader.result !== null && typeof reader.result !== 'string') result.resolve(reader.result)
    else result.reject(new Error('未读取到二进制数据'))
  }
  reader.onerror = () => result.reject(reader.error)
  reader.readAsArrayBuffer(this)
  return result.promise
}

beforeEach(({ onTestFinished }) => {
  if (!Blob.prototype.arrayBuffer) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value: readBlob })
    onTestFinished(() => {
      Reflect.deleteProperty(Blob.prototype, 'arrayBuffer')
    })
  }
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      locks: {
        value: {
          request: async (_: string, options: LockOptions, job: () => Promise<void>) => {
            options.signal?.throwIfAborted()
            locked = true
            try {
              await job()
            } finally {
              locked = false
            }
          },
        },
      },
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function connect() {
  const frame = await waitFor(() => {
    const element = document.querySelector('iframe')
    if (!element?.contentWindow) throw new Error('打印帧未挂载')
    return element
  })
  const peer = frame.contentWindow
  if (!peer) throw new Error('打印帧缺少窗口')
  const nonce = new URL(frame.src).hash.slice(1)
  const envelope = {
    v: PROTOCOL_VERSION,
    nonce: new URLSearchParams(nonce).get('nonce'),
    version: 7,
  }
  const send = (message: object) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: peer,
        origin: 'null',
        data: { ...envelope, ...message },
      }),
    )
  const spy = vi.spyOn(peer, 'postMessage').mockImplementation(() => {})
  const requests = () => spy.mock.calls.map(([msg]) => ShellToSandboxMessageSchema.parse(msg))
  send({ type: 'ready' })
  const reply = (page: number, last: boolean, fixture = a4, version = 7) =>
    send({
      type: 'capture.print.result',
      page,
      version,
      last,
      png: new Blob([Uint8Array.from(atob(fixture), (char) => char.charCodeAt(0))], {
        type: 'image/png',
      }),
    })
  return { frame, send, requests, spy, reply }
}

it('同一纸宽帧按消费进度只传下一张，拒收旧版本与错页，不传辅助线', async () => {
  const signal = new AbortController().signal
  const pages = captureBoardPrintPages(board, 7, signal)
  const first = pages.next()
  const { frame, send, requests, spy, reply } = await connect()
  try {
    expect(requests()).toMatchObject([{ type: 'render', printPaper: 'a4', boardId: 'report' }])
    expect(spy.mock.calls[0][0]).not.toHaveProperty('layoutGuides')
    expect(Number.parseFloat(frame.style.width)).toBeCloseTo(793.7008, 3)
    send({ type: 'rendered', version: 6 })
    expect(requests()).toHaveLength(1)
    send({ type: 'rendered' })
    expect(requests().at(-1)).toMatchObject({ type: 'capture.print', page: 0, version: 7 })
    reply(0, true, letter, 6)
    reply(1, true, letter)
    reply(0, false)
    const page = await first
    expect(page.value).toMatchObject({ width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 })
    expect(requests()).toHaveLength(2)
    expect(locked).toBe(true)
    const second = pages.next()
    await waitFor(() => expect(requests().at(-1)).toMatchObject({ type: 'capture.print', page: 1 }))
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    reply(1, true)
    await second
    expect(frame.isConnected).toBe(false)
    expect(locked).toBe(false)
    expect((await pages.next()).done).toBe(true)
  } finally {
    await pages.return(undefined)
  }
})

it.each(['取消', '终止迭代', '位图错纸', '渲染失败'])(
  '%s 时不保留打印帧或独占锁',
  async (cause) => {
    const controller = new AbortController()
    const pages = captureBoardPrintPages(
      { ...board, printLayout: { mode: 'flow', paper: 'letter' } },
      7,
      controller.signal,
    )
    const first = pages.next()
    const { frame, send, reply } = await connect()
    send({ type: 'rendered' })
    if (cause === '位图错纸') {
      reply(0, true, a4)
      await expect(first).rejects.toThrow('PNG')
    } else if (cause === '渲染失败') {
      send({ type: 'capture.print.failure', page: 0, message: '图片解码失败' })
      await expect(first).rejects.toThrow()
    } else {
      reply(0, false, letter)
      await first
      if (cause === '取消') {
        controller.abort()
        expect(frame.isConnected).toBe(false)
        await expect(pages.next()).rejects.toHaveProperty('name', 'AbortError')
      } else await pages.return(undefined)
    }
    expect(frame.isConnected).toBe(false)
    expect(locked).toBe(false)
  },
)
