import {
  type ArtboardAppearance,
  type ArtboardTweak,
  type ArtifactType,
  type DesignLayer,
  resolveArtboardTweaks,
} from '@akasha/protocol'
import { resolveSandboxOrigin } from '../config/runtime'
import { getMessages } from '../i18n/messages'
import { captureMessages } from './capture-messages'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
} from './host'

interface PngBoard {
  id: string
  scoped: boolean
  type: ArtifactType
  source: string
  /** 原生绘制的数据属于同一版本，必须随作者源码一起栅格化。 */
  designLayers?: DesignLayer[]
  appearance?: ArtboardAppearance
  tweaks?: readonly ArtboardTweak[]
  width: number
  height: number
}

/** 对指定版本渲染一次静态 PNG。同一外壳 origin 一次最多启动一个临时沙盒。 */
export async function captureBoardPng(
  board: PngBoard,
  version: number,
  scale: number,
  signal: AbortSignal,
): Promise<Blob> {
  if (!navigator.locks)
    throw new Error(getMessages(captureMessages).t('当前浏览器不能在安全上下文中渲染画板 PNG'))
  return navigator.locks.request('akasha-capture-png', { signal }, () =>
    renderPng(board, version, scale, signal),
  )
}

async function renderPng(board: PngBoard, version: number, scale: number, signal: AbortSignal) {
  const lifetime = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
  lifetime.throwIfAborted()
  const nonce = createBridgeNonce()
  const sandboxOrigin = resolveSandboxOrigin()
  const iframe = document.createElement('iframe')
  iframe.title = getMessages(captureMessages).t('画板渲染任务')
  iframe.width = String(board.width)
  iframe.height = String(board.height)
  iframe.setAttribute('sandbox', SANDBOX_IFRAME_SANDBOX_ATTR)
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.inert = true
  iframe.referrerPolicy = 'no-referrer'
  iframe.src = buildSandboxIframeUrl(sandboxOrigin, nonce, window.location.origin)
  // 不移出视口：Chromium 会暂停不可见跨源 iframe 的动画帧。
  iframe.style.cssText =
    'position:fixed; left:0; top:0; opacity:0; z-index:-1; border:0; pointer-events:none'
  const host = new SandboxBridgeHost({
    nonce,
    sandboxOrigin,
    getIframeWindow: () => iframe.contentWindow,
  })
  const { promise, resolve, reject } = Promise.withResolvers<Blob>()
  const abort = () => reject(lifetime.reason)
  lifetime.addEventListener('abort', abort, { once: true })
  let requested = false
  const off = host.onMessage((message) => {
    if (message.type === 'error') reject(new Error(message.message))
    else if (message.type === 'rendered' && message.version === version && !requested) {
      requested = true
      host.send({ type: 'capture.png', version, width: board.width, height: board.height, scale })
    } else if (message.type === 'capture.png.result' && message.version === version && requested) {
      resolve(message.png)
    } else if (message.type === 'capture.png.failure' && message.version === version && requested) {
      reject(new Error(message.message))
    } else if (message.type === 'storage.request') {
      host.send({
        type: 'storage.response',
        requestId: message.requestId,
        ok: false,
        error: getMessages(captureMessages).t('静态画板不读取或修改制品运行存储'),
      })
    }
  })
  try {
    host.start()
    host.send({
      type: 'render',
      version,
      artifactType: board.type,
      source: board.source,
      designLayers: board.designLayers,
      boardAppearance: board.appearance,
      boardTweaks: board.tweaks?.length ? resolveArtboardTweaks(board.tweaks) : undefined,
      ...(board.scoped ? { boardId: board.id } : {}),
      state: {},
    })
    document.body.append(iframe)
    const png = await promise
    const header = new DataView(await png.slice(0, 24).arrayBuffer())
    if (
      header.byteLength !== 24 ||
      header.getUint32(0) !== 0x89504e47 ||
      header.getUint32(4) !== 0x0d0a1a0a ||
      header.getUint32(12) !== 0x49484452 ||
      header.getUint32(16) !== Math.round(board.width * scale) ||
      header.getUint32(20) !== Math.round(board.height * scale)
    ) {
      throw new Error(getMessages(captureMessages).t('沙盒返回的 PNG 格式或尺寸不符'))
    }
    return png
  } finally {
    lifetime.removeEventListener('abort', abort)
    off()
    host.stop()
    iframe.remove()
  }
}
