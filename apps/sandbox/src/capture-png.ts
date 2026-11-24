import { toBlob } from 'html-to-image'

const MAX_PIXELS = 16_777_216

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
  if (!root.firstElementChild) throw new Error('画板尚未渲染，不能生成 PNG')

  await root.ownerDocument.fonts.ready
  signal?.throwIfAborted()
  // Tailwind 浏览器运行时通过 MutationObserver 更新样式；等样式和布局应用后再克隆。
  const painted = Promise.withResolvers<void>()
  requestAnimationFrame(() => requestAnimationFrame(() => painted.resolve()))
  await painted.promise
  signal?.throwIfAborted()
  try {
    await Promise.all([...root.querySelectorAll('img')].map((image) => image.decode()))
  } catch (cause) {
    throw new Error('画板中有无法加载或解码的图片', { cause })
  }
  signal?.throwIfAborted()

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
