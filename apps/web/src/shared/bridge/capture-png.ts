import { getArtboardPaperSize, type SandboxToShellMessage } from '@akasha/protocol'
import { getMessages } from '../i18n/messages'
import {
  type CaptureBoard,
  captureLocks,
  createCaptureFrame,
  validateCapturePng,
} from './capture-frame'
import { captureMessages } from './capture-messages'

const CAPTURE_LOCK = 'akasha-capture-png'

/** 对指定版本渲染一次静态 PNG。同一外壳 origin 一次最多启动一个临时沙盒。 */
export async function captureBoardPng(
  board: CaptureBoard,
  version: number,
  scale: number,
  signal: AbortSignal,
): Promise<Blob> {
  return captureLocks().request(CAPTURE_LOCK, { signal }, () =>
    renderPng(board, version, scale, signal),
  )
}

async function renderPng(board: CaptureBoard, version: number, scale: number, signal: AbortSignal) {
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  lifetime.throwIfAborted()
  const frame = createCaptureFrame(board, version, board)
  const { promise, resolve, reject } = Promise.withResolvers<Blob>()
  const abort = () => reject(lifetime.reason)
  lifetime.addEventListener('abort', abort, { once: true })
  let requested = false
  const off = frame.host.onMessage((message) => {
    if (message.type === 'error') reject(new Error(message.message))
    else if (message.type === 'rendered' && message.version === version && !requested) {
      requested = true
      frame.host.send({
        type: 'capture.png',
        version,
        width: board.width,
        height: board.height,
        scale,
      })
    } else if (message.type === 'capture.png.result' && message.version === version && requested) {
      resolve(message.png)
    } else if (message.type === 'capture.png.failure' && message.version === version && requested) {
      reject(new Error(message.message))
    }
  })
  try {
    frame.mount()
    const png = await promise
    await validateCapturePng(png, board.width * scale, board.height * scale)
    lifetime.throwIfAborted()
    return png
  } finally {
    lifetime.removeEventListener('abort', abort)
    off()
    frame.dispose()
  }
}

type PrintResult = Extract<SandboxToShellMessage, { type: 'capture.print.result' }>

/** 只在消费者拉取时栅格化下一张；尺寸为未取整的纸张 CSS 像素。 */
export async function* captureBoardPrintPages(
  board: CaptureBoard,
  version: number,
  signal: AbortSignal,
): AsyncGenerator<{ png: Blob; width: number; height: number }> {
  if (board.printLayout?.mode !== 'flow') {
    const png = await captureBoardPng(board, version, 1, signal)
    yield { png, width: board.width, height: board.height }
    return
  }
  const paper = board.printLayout.paper
  const size = getArtboardPaperSize(paper)
  const locks = captureLocks()
  const frame = createCaptureFrame(board, version, size, paper)
  const granted = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const lifetime = new AbortController()
  let page = 0
  let rendered = false
  let pending: PromiseWithResolvers<PrintResult> | undefined
  const close = (reason?: unknown) => {
    if (lifetime.signal.aborted) return
    lifetime.abort(reason)
    pending?.reject(lifetime.signal.reason)
    off()
    signal.removeEventListener('abort', abort)
    frame.dispose()
    released.resolve()
  }
  const abort = () => close(signal.reason)
  const off = frame.host.onMessage((message) => {
    if (message.type === 'rendered' && message.version === version && !rendered) {
      rendered = true
      frame.host.send({ type: 'capture.print', page, version })
    }
    if (message.type !== 'error') {
      if (!rendered || !pending) return
      if (message.type !== 'capture.print.result' && message.type !== 'capture.print.failure')
        return
      if (message.version !== version || message.page !== page) return
      if (message.type === 'capture.print.result') {
        pending.resolve(message)
        return
      }
    }
    close(
      new Error(getMessages(captureMessages).t('无法生成画板打印页'), { cause: message.message }),
    )
  })
  try {
    // Web Lock 的回调必须跨越多次 yield；放弃迭代或 AbortSignal 取消都会解锁。
    void locks
      .request(CAPTURE_LOCK, { signal }, () => {
        granted.resolve()
        return released.promise
      })
      .catch(granted.reject)
    await granted.promise
    signal.throwIfAborted()
    signal.addEventListener('abort', abort, { once: true })
    for (;;) {
      lifetime.signal.throwIfAborted()
      pending = Promise.withResolvers<PrintResult>()
      const timeout = window.setTimeout(
        () => close(new Error(getMessages(captureMessages).t('画板打印页渲染超时'))),
        30_000,
      )
      let result: PrintResult
      try {
        if (page === 0) frame.mount()
        else frame.host.send({ type: 'capture.print', page, version })
        result = await pending.promise
      } finally {
        window.clearTimeout(timeout)
        pending = undefined
      }
      await validateCapturePng(result.png, size.width, size.height)
      lifetime.signal.throwIfAborted()
      if (result.last) close()
      yield { png: result.png, ...size }
      if (result.last) return
      page++
    }
  } finally {
    close()
  }
}
