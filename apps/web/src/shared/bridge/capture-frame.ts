import {
  type ArtboardAppearance,
  type ArtboardPrintLayout,
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

/** 定版捕捉只读取作品内容，不把外壳的辅助线或临时参数送进沙盒。 */
export interface CaptureBoard {
  id: string
  scoped: boolean
  type: ArtifactType
  source: string
  designLayers?: DesignLayer[]
  appearance?: ArtboardAppearance
  tweaks?: readonly ArtboardTweak[]
  printLayout?: ArtboardPrintLayout
  width: number
  height: number
}

/** 同源外壳只允许一个临时捕捉帧；逐页消费者在读完或取消时释放。 */
export function captureLocks() {
  if (!navigator.locks)
    throw new Error(getMessages(captureMessages).t('当前浏览器不能在安全上下文中渲染画板 PNG'))
  return navigator.locks
}

/** 帧只在 mount 时开始接收消息；无论成功、失败或提前停止，都须 dispose。 */
export function createCaptureFrame(
  board: CaptureBoard,
  version: number,
  { width, height }: { width: number; height: number },
  printPaper?: 'a4' | 'letter',
) {
  const nonce = createBridgeNonce()
  const sandboxOrigin = resolveSandboxOrigin()
  const iframe = document.createElement('iframe')
  iframe.title = getMessages(captureMessages).t('画板渲染任务')
  iframe.width = String(Math.round(width))
  iframe.height = String(Math.round(height))
  iframe.setAttribute('sandbox', SANDBOX_IFRAME_SANDBOX_ATTR)
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.inert = true
  iframe.referrerPolicy = 'no-referrer'
  iframe.src = buildSandboxIframeUrl(sandboxOrigin, nonce, window.location.origin)
  // 不移出视口：Chromium 会暂停不可见跨源 iframe 的动画帧。
  iframe.style.cssText = `position:fixed;left:0;top:0;opacity:0;z-index:-1;border:0;pointer-events:none;width:${width}px;height:${height}px`
  const host = new SandboxBridgeHost({
    nonce,
    sandboxOrigin,
    getIframeWindow: () => iframe.contentWindow,
  })
  const off = host.onMessage((message) => {
    if (message.type === 'storage.request')
      host.send({
        type: 'storage.response',
        requestId: message.requestId,
        ok: false,
        error: getMessages(captureMessages).t('静态画板不读取或修改制品运行存储'),
      })
  })
  const mount = () => {
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
      ...(printPaper ? { printPaper } : {}),
      state: {},
    })
    document.body.append(iframe)
  }
  const dispose = () => {
    off()
    host.stop()
    iframe.remove()
  }
  return { host, mount, dispose }
}

/** 比对 PNG 自身的 IHDR，不能把沙盒回传的 MIME 或画板尺寸当作位图尺寸。 */
export async function validateCapturePng(png: Blob, width: number, height: number) {
  const header = new DataView(await png.slice(0, 24).arrayBuffer())
  if (
    header.byteLength !== 24 ||
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(4) !== 0x0d0a1a0a ||
    header.getUint32(8) !== 13 ||
    header.getUint32(12) !== 0x49484452 ||
    header.getUint32(16) !== Math.round(width) ||
    header.getUint32(20) !== Math.round(height)
  ) {
    throw new Error(getMessages(captureMessages).t('沙盒返回的 PNG 格式或尺寸不符'))
  }
}
