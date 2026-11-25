import { type ArtboardPrintLayout, getArtboardPaperSize } from '@akasha/protocol'
import { toSvg } from 'html-to-image'
import { waitForCaptureResources, waitForCaptureStep } from './capture-png'
import { pauseOverviewMotion } from './overview-motion'

type Paper = Extract<ArtboardPrintLayout, { mode: 'flow' }>['paper']
interface PrintPage {
  png: Blob
  last: boolean
}

/** 一次定版打印从第 0 页开始顺序读取；关闭后不能再复用。 */
export interface PrintSession {
  read: (root: HTMLElement, page: number) => Promise<PrintPage>
  close: () => void
}

interface Span {
  top: number
  bottom: number
}

function readUnbrokenSpans(root: HTMLElement, pageHeight: number) {
  const spans: Span[] = []
  const origin = root.getBoundingClientRect().top
  const addRect = (rect: DOMRect) => {
    if (rect.width > 0 && rect.height > 0 && rect.height <= pageHeight) {
      spans.push({ top: rect.top - origin, bottom: rect.bottom - origin })
    }
  }
  const text = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = root.ownerDocument.createRange()
  for (let node = text.nextNode(); node; node = text.nextNode()) {
    if (!node.textContent?.trim() || node.parentElement?.closest('svg,style,script')) continue
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) addRect(rect)
  }
  for (const element of root.querySelectorAll('img,svg,canvas,video,tr')) {
    addRect(element.getBoundingClientRect())
  }
  spans.sort((a, b) => a.top - b.top)
  const merged: Span[] = []
  for (const span of spans) {
    const previous = merged.at(-1)
    if (previous && span.top < previous.bottom) {
      previous.bottom = Math.max(previous.bottom, span.bottom)
    } else {
      merged.push(span)
    }
  }
  return merged
}

function expandScrollports(root: HTMLElement) {
  // 从里到外展开有实际溢出的纵向滚动区；保留作者用于遮罩、圆角等的裁剪。
  const nodes = root.querySelectorAll('*')
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]
    if (!(node instanceof HTMLElement) || node.scrollHeight <= node.clientHeight) continue
    const overflow = getComputedStyle(node).overflowY
    if (overflow !== 'scroll' && overflow !== 'auto') continue
    const expanded = node.scrollHeight + node.offsetHeight - node.clientHeight
    node.style.setProperty('max-height', 'none', 'important')
    node.style.setProperty('height', `${expanded}px`, 'important')
    node.style.setProperty('box-sizing', 'border-box', 'important')
    node.style.setProperty('flex-shrink', '0', 'important')
  }
}

async function* printPages(root: HTMLElement, paper: Paper, signal: AbortSignal) {
  const { width, height } = getArtboardPaperSize(paper)
  for (const image of root.querySelectorAll<HTMLImageElement>('img[loading="lazy"]')) {
    image.loading = 'eager'
  }
  // 屏外长段落可能只有占位高度；打印要读取实际行框，但不能打开作者显式隐藏的元素。
  for (const node of root.querySelectorAll('*')) {
    if (node instanceof HTMLElement && getComputedStyle(node).contentVisibility === 'auto') {
      node.style.setProperty('content-visibility', 'visible', 'important')
    }
  }
  const html = root.querySelector<HTMLElement>(':scope > [data-ak-renderer="html"].min-h-screen')
  if (html) html.style.minHeight = '0'
  await waitForCaptureResources(root, signal)
  const paused = pauseOverviewMotion(root)
  let encoded: string
  let contentHeight: number
  let spans: Span[]
  try {
    expandScrollports(root)
    const boxHeight = root.getBoundingClientRect().height
    // scrollHeight 为整数；分数纸高不能仅因浏览器取整被计为还有一页。
    const overflowHeight = root.scrollHeight
    contentHeight = Math.max(1, overflowHeight > Math.ceil(boxHeight) ? overflowHeight : boxHeight)
    spans = readUnbrokenSpans(root, height)
    // 只生成一次含计算样式、字体、图片和原生图层的矢量快照，不解码成整稿位图。
    const snapshot = toSvg(root, {
      width,
      height: contentHeight,
      style: { height: `${boxHeight}px` },
      filter: (node) => !(node instanceof Element && node.matches('script,style,link')),
    })
    const svg = await waitForCaptureStep(snapshot, signal)
    const prefix = 'data:image/svg+xml;charset=utf-8,'
    if (!svg.startsWith(prefix)) throw new Error('打印快照不是 SVG')
    encoded = svg.slice(prefix.length)
  } finally {
    paused.resume()
  }
  signal.throwIfAborted()
  const canvas = root.ownerDocument.createElement('canvas')
  canvas.width = Math.round(width)
  canvas.height = Math.round(height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器无法生成打印页')
  const end = encodeURIComponent('</svg></svg>')
  let span = 0
  for (let top = 0; top < contentHeight; ) {
    const limit = top + height
    // 浏览器的布局坐标按子像素量化；不足一个布局单位的差异不是新的一页。
    const last = contentHeight <= limit + 1 / 64
    let bottom = last ? contentHeight : limit
    if (!last) {
      while (span < spans.length && spans[span].bottom <= limit) span++
      const crossing = spans[span]
      if (crossing && crossing.top > top && crossing.top < limit) bottom = crossing.top
    }
    const used = bottom - top
    // 内视口只画本片，外视口始终满张白纸。超高单个元素按原坐标连续切，不缩小、不丢尾。
    const start = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"
      viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <rect width="100%" height="100%" fill="white"/>
      <svg width="${width}" height="${used}" viewBox="0 ${top} ${width} ${used}" overflow="hidden">`
    const image = root.ownerDocument.createElement('img')
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(start)}${encoded}${end}`
    await waitForCaptureStep(image.decode(), signal)
    signal.throwIfAborted()
    ctx.drawImage(image, 0, 0)
    const blob = Promise.withResolvers<Blob | null>()
    canvas.toBlob(blob.resolve, 'image/png')
    const png = await waitForCaptureStep(blob.promise, signal)
    signal.throwIfAborted()
    if (!png?.size || png.size > 32 * 1024 * 1024) throw new Error('无法传送画板打印页')
    yield { png, last }
    top = bottom
  }
}

/** 专用帧只允许按序取页；替换 render 或卸载时取消正在进行的读取，并丢弃快照。 */
export function createPrintSession(paper: Paper): PrintSession {
  const controller = new AbortController()
  let pages: AsyncGenerator<PrintPage, void> | undefined
  let next = 0
  let busy = false
  const read = async (root: HTMLElement, page: number) => {
    controller.signal.throwIfAborted()
    if (busy || page !== next) throw new Error('打印页序与当前画板不符')
    busy = true
    try {
      pages ??= printPages(root, paper, controller.signal)
      const result = await pages.next()
      controller.signal.throwIfAborted()
      if (result.done) throw new Error('已到达画板最后一页')
      next++
      if (result.value.last) await pages.return()
      return result.value
    } finally {
      busy = false
    }
  }
  const close = () => {
    controller.abort()
    void pages?.return()
  }
  return { read, close }
}
