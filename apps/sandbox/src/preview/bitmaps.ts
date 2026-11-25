import { embeddedBitmapKind, embeddedBitmapPoster } from './bitmap-format'
import { rewriteCssImages, rewriteImageSrcset } from './css-images'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const MAX_IMAGE_SOURCE = 5_592_441 // 4 MiB 位图的 base64 及数据 URI 头。
const MAX_IMAGE_JOBS = 16
const MAX_PARALLEL_DECODES = 3
const DECODE_WINDOW_MS = 1200
const MAX_DECODE_PIXELS = 16_777_216
const MAX_CANVAS_EDGE = 1024
const MAX_RASTER_CHARS = 2_000_000
const SVG_PAINT_ATTRS =
  'fill stroke filter clip-path mask marker marker-start marker-mid marker-end cursor'.split(' ')
const SVG_PAINT_SELECTORS = SVG_PAINT_ATTRS.map((attr) => `[${attr}*="("]`).join(',')

type ImageUrl = string | Promise<string>

function rasterize(url: URL, doc: Document, signal: AbortSignal): Promise<string> {
  if (signal.aborted) return Promise.resolve(PLACEHOLDER)
  const { promise, resolve } = Promise.withResolvers<string>()
  const image = doc.createElement('img')
  const finish = (result: string) => {
    signal.removeEventListener('abort', abort)
    image.onload = null
    image.onerror = null
    image.removeAttribute('src')
    resolve(result)
  }
  const abort = () => finish(PLACEHOLDER)
  signal.addEventListener('abort', abort, { once: true })
  image.onerror = abort
  image.onload = () => {
    const { naturalWidth: width, naturalHeight: height } = image
    if (!width || !height || width * height > MAX_DECODE_PIXELS) {
      abort()
      return
    }
    const canvas = doc.createElement('canvas')
    const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(width, height))
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    try {
      const context = canvas.getContext('2d')
      if (!context) {
        abort()
        return
      }
      // CanvasImageSource 对动图使用默认海报或首帧；输出的 PNG 没有独立时间轴。
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const frame = canvas.toDataURL('image/png')
      finish(
        frame.length <= MAX_RASTER_CHARS && frame.startsWith('data:image/png;')
          ? frame
          : PLACEHOLDER,
      )
    } catch {
      // 透明 origin 读不到没有 CORS 授权的位图像素，不能回退到原始动图。
      abort()
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') image.crossOrigin = 'anonymous'
  image.src = url.href
  return promise
}

/** 挂载设计视图之前替换无法暂停的图片；任何失败或越界都不会保留可动的原图。 */
export function freezePreviewBitmaps(
  fragment: DocumentFragment,
  doc: Document,
  signal: AbortSignal,
): Promise<void> | undefined {
  const candidates = new Map<string, ImageUrl>()
  const pending: Array<{ url: URL; resolve: (result: string) => void }> = []
  const changes: Promise<void>[] = []
  let jobs = 0

  const freeze = (raw: string): ImageUrl => {
    const source = raw.trim()
    if (!source) return raw
    const existing = candidates.get(source)
    if (existing !== undefined) return existing === source ? raw : existing
    const kind = embeddedBitmapKind(source)
    if (kind === 'static') {
      candidates.set(source, source)
      return raw
    }
    if (source.length > MAX_IMAGE_SOURCE || jobs >= MAX_IMAGE_JOBS) return PLACEHOLDER
    if (kind === 'gif' || kind === 'apng') {
      jobs++
      const poster = embeddedBitmapPoster(source, kind) ?? PLACEHOLDER
      candidates.set(source, poster)
      return poster
    }
    let url: URL
    try {
      url = new URL(source, doc.baseURI)
    } catch {
      return PLACEHOLDER
    }
    if (
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:' &&
      !(
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.origin === doc.location.origin
      )
    ) {
      return PLACEHOLDER
    }
    jobs++
    const { promise, resolve } = Promise.withResolvers<string>()
    pending.push({ url, resolve })
    candidates.set(source, promise)
    return promise
  }
  const paintUrl = (url: string) => (url.trim().startsWith('#') ? url : freeze(url))
  const apply = (original: string, result: ImageUrl, set: (value: string) => void) => {
    if (typeof result === 'string') {
      if (result !== original) set(result)
    } else {
      changes.push(result.then(set))
    }
  }
  const rewriteAttribute = (
    element: Element,
    attr: string,
    rewrite: (value: string) => ImageUrl,
  ) => {
    const original = element.getAttribute(attr)
    if (original !== null)
      apply(original, rewrite(original), (value) => element.setAttribute(attr, value))
  }

  for (const element of fragment.querySelectorAll('link[rel~="stylesheet" i]')) element.remove()
  const imageReferences =
    'img, picture source[srcset], input[type="image" i], video[poster], [background]'
  for (const element of fragment.querySelectorAll(imageReferences)) {
    switch (element.localName) {
      case 'img':
        rewriteAttribute(element, 'src', freeze)
        // 转换后的 data URL 已不需要携带请求凭据。
        element.removeAttribute('crossorigin')
        break
      case 'input':
        rewriteAttribute(element, 'src', freeze)
        break
      case 'video':
        rewriteAttribute(element, 'poster', freeze)
        break
    }
    if (element.localName === 'img' || element.localName === 'source') {
      rewriteAttribute(element, 'srcset', (value) => rewriteImageSrcset(value, freeze))
    }
    rewriteAttribute(element, 'background', freeze)
  }
  for (const element of fragment.querySelectorAll('svg :is(image, feImage, use, animate, set)')) {
    if (element.namespaceURI !== SVG_NAMESPACE) continue
    switch (element.localName) {
      case 'image':
      case 'feImage':
        rewriteAttribute(element, 'href', paintUrl)
        rewriteAttribute(element, 'xlink:href', paintUrl)
        break
      case 'use':
        for (const attr of ['href', 'xlink:href']) {
          const value = element.getAttribute(attr)
          if (value && !value.trim().startsWith('#')) element.removeAttribute(attr)
        }
        break
      case 'animate':
      case 'set': {
        // 引用值变化可绕过挂载前的静帧转换。
        const attr = element.getAttribute('attributeName')?.trim().toLowerCase()
        const assetAttrs = ['href', 'xlink:href', 'src', 'srcset', 'poster', 'background', 'style']
        if (attr && assetAttrs.includes(attr)) {
          element.remove()
          continue
        }
        if (attr && SVG_PAINT_ATTRS.includes(attr)) {
          for (const valueAttr of ['values', 'from', 'to', 'by']) {
            rewriteAttribute(element, valueAttr, (value) => rewriteCssImages(value, paintUrl))
          }
        }
        break
      }
    }
  }
  for (const element of fragment.querySelectorAll(SVG_PAINT_SELECTORS)) {
    if (element.namespaceURI !== SVG_NAMESPACE) continue
    for (const attr of SVG_PAINT_ATTRS) {
      rewriteAttribute(element, attr, (value) => rewriteCssImages(value, paintUrl))
    }
  }
  for (const element of fragment.querySelectorAll('style, [style], [class*="url(" i]')) {
    if (element.localName === 'style') {
      const css = element.textContent ?? ''
      apply(css, rewriteCssImages(css, paintUrl), (value) => {
        element.textContent = value
      })
    }
    rewriteAttribute(element, 'style', (value) => rewriteCssImages(value, paintUrl))
    if (element.getAttribute('class')?.includes('-[')) {
      rewriteAttribute(element, 'class', (value) => rewriteCssImages(value, paintUrl))
    }
  }
  if (!changes.length) return undefined

  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(abort, DECODE_WINDOW_MS)
  let next = 0
  const decode = async () => {
    while (next < pending.length) {
      const { url, resolve } = pending[next++]
      resolve(await rasterize(url, doc, controller.signal))
    }
  }
  const workers = Array.from({ length: Math.min(MAX_PARALLEL_DECODES, pending.length) }, decode)
  return Promise.all([...workers, ...changes])
    .then(() => undefined)
    .finally(() => {
      signal.removeEventListener('abort', abort)
      clearTimeout(timeout)
    })
}
