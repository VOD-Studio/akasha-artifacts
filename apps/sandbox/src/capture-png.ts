import { toBlob } from 'html-to-image'

const MAX_PIXELS = 16_777_216

/** 浏览器的解码与字体 API 不接受 signal；取消后不继续排版或保留捕捉监听。 */
export async function waitForCaptureStep<T>(work: Promise<T>, signal?: AbortSignal) {
  if (!signal) return work
  signal.throwIfAborted()
  const stopped = Promise.withResolvers<never>()
  const abort = () => stopped.reject(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([work, stopped.promise])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

/** 两个动画帧给 Tailwind 提交样式；待本次排版使用的字体和图片就绪后再克隆。 */
export async function waitForCaptureResources(root: HTMLElement, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!root.firstElementChild) throw new Error('画板尚未渲染，不能生成 PNG')
  await waitForCaptureStep(root.ownerDocument.fonts.ready, signal)
  signal?.throwIfAborted()
  const painted = Promise.withResolvers<void>()
  requestAnimationFrame(() => requestAnimationFrame(() => painted.resolve()))
  await waitForCaptureStep(painted.promise, signal)
  signal?.throwIfAborted()
  try {
    const images = [...root.querySelectorAll('img')].map((image) => image.decode())
    await waitForCaptureStep(Promise.all(images), signal)
  } catch (cause) {
    signal?.throwIfAborted()
    throw new Error('画板中有无法加载或解码的图片', { cause })
  }
  await waitForCaptureStep(root.ownerDocument.fonts.ready, signal)
  signal?.throwIfAborted()
}

/** 在受控沙盒原地栅格化已绘制的 DOM；不放宽 CSP 或读取外壳内容。 */
export async function captureSandboxPng(
  root: HTMLElement,
  width: number,
  height: number,
  scale: number,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted()
  const outputWidth = Math.round(width * scale)
  const outputHeight = Math.round(height * scale)
  if (outputWidth < 1 || outputHeight < 1 || outputWidth * outputHeight > MAX_PIXELS) {
    throw new Error('画板的输出尺寸超出 PNG 渲染范围')
  }
  await waitForCaptureResources(root, signal)

  const png = await toBlob(root, {
    width,
    height,
    canvasWidth: outputWidth,
    canvasHeight: outputHeight,
    pixelRatio: 1,
    skipAutoScale: true,
    skipFonts: true,
    filter: (node) => !(node instanceof Element && node.matches('script, style, link')),
  })
  signal?.throwIfAborted()
  if (!png?.size) throw new Error('浏览器无法生成画板 PNG')
  return png
}
