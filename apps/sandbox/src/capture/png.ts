import { toBlob } from 'html-to-image'
import { waitForCaptureResources } from './resources'

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
