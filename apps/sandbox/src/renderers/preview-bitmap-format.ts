const PNG_MAGIC = '\x89PNG\r\n\x1a\n'
const MAX_PNG_CHUNKS = 2048
const MAX_FRAME_PIXELS = 16_777_216

/** 只有经文件头确认的静图才能不转码，不能依据 URL 扩展名判断。 */
export type EmbeddedBitmap = 'static' | 'gif' | 'apng' | 'unknown'

function readBase64(source: string, payload: number, start: number, length: number): string {
  const offset = start % 3
  const from = payload + ((start - offset) / 3) * 4
  const end = from + Math.ceil((offset + length) / 3) * 4
  return atob(source.slice(from, end)).slice(offset, offset + length)
}

function u32be(bytes: string, offset: number): number {
  return (
    bytes.charCodeAt(offset) * 0x1000000 +
    (bytes.charCodeAt(offset + 1) << 16) +
    (bytes.charCodeAt(offset + 2) << 8) +
    bytes.charCodeAt(offset + 3)
  )
}

function u16le(bytes: string, offset: number): number {
  return bytes.charCodeAt(offset) + (bytes.charCodeAt(offset + 1) << 8)
}

/** 原样保留静态 JPEG／PNG／WebP；PNG 只读块头，不解压像素或复制数据。 */
export function embeddedBitmapKind(url: string): EmbeddedBitmap {
  if (!/^data:image\//i.test(url)) return 'unknown'
  const comma = url.indexOf(',')
  if (comma < 0 || comma > 100) return 'unknown'
  const header = url.slice(0, comma).toLowerCase()
  if (!/^data:image\/(?:jpeg|png|apng|gif|webp);base64$/.test(header)) return 'unknown'
  const first = comma + 1
  try {
    const peek = atob(url.slice(first, first + 32))
    if (header === 'data:image/jpeg;base64' && peek.startsWith('\xff\xd8\xff')) return 'static'
    if (header === 'data:image/gif;base64' && /^GIF8[79]a/.test(peek)) return 'gif'
    if (header === 'data:image/webp;base64' && /^RIFF....WEBP/s.test(peek)) {
      const chunk = peek.slice(12, 16)
      if (chunk === 'VP8 ' || chunk === 'VP8L') return 'static'
      if (chunk === 'VP8X' && peek.length > 20 && (peek.charCodeAt(20) & 2) === 0) return 'static'
    }
    if (!/^data:image\/a?png;base64$/.test(header) || !peek.startsWith(PNG_MAGIC)) return 'unknown'
    if (peek.slice(12, 16) !== 'IHDR' || /[\t\n\f\r %]/.test(url)) return 'unknown'
    for (let offset = 8, count = 0; count < MAX_PNG_CHUNKS; count++) {
      // 直接从源码读取块头，不切出整段 base64 或为像素创建中间缓冲区。
      const aligned = first + Math.floor(offset / 3) * 4
      if (aligned >= url.length) break
      const chunk = readBase64(url, first, offset, 8)
      if (chunk.length !== 8) break
      const type = chunk.slice(4)
      if (type === 'acTL') return 'apng'
      // acTL 必须在默认图像的 IDAT 之前。
      if (type === 'IDAT') return 'static'
      offset += u32be(chunk, 0) + 12
    }
  } catch {
    // 非规范的数据 URI 交给浏览器解码；不会直接挂载原图。
  }
  return 'unknown'
}

function pngPoster(bytes: string): string | undefined {
  if (u32be(bytes, 16) * u32be(bytes, 20) > MAX_FRAME_PIXELS) return undefined
  let poster = PNG_MAGIC
  let sawImage = false
  for (let start = 8, count = 0; start + 12 <= bytes.length && count < MAX_PNG_CHUNKS; count++) {
    const end = start + u32be(bytes, start) + 12
    if (end > bytes.length) break
    const type = bytes.slice(start + 4, start + 8)
    if (type !== 'acTL' && type !== 'fcTL' && type !== 'fdAT') poster += bytes.slice(start, end)
    if (type === 'IDAT') sawImage = true
    if (type === 'IEND') return sawImage ? `data:image/png;base64,${btoa(poster)}` : undefined
    start = end
  }
  return undefined
}

function subBlocksEnd(bytes: string, start: number): number {
  while (start < bytes.length) {
    const length = bytes.charCodeAt(start++)
    if (length === 0) return start
    start += length
  }
  return 0
}

function gifPoster(bytes: string): string | undefined {
  if (bytes.length < 13 || u16le(bytes, 6) * u16le(bytes, 8) > MAX_FRAME_PIXELS) return undefined
  const flags = bytes.charCodeAt(10)
  const headerEnd = 13 + (flags & 128 ? 3 * 2 ** ((flags & 7) + 1) : 0)
  let graphicControl = ''
  for (let start = headerEnd; start + 2 <= bytes.length; ) {
    const type = bytes.charCodeAt(start)
    if (type === 0x21) {
      const end = subBlocksEnd(bytes, start + 2)
      if (!end) break
      const extension = bytes.charCodeAt(start + 1)
      if (extension === 0xf9) graphicControl = bytes.slice(start, end)
      if (extension === 0x01) graphicControl = ''
      start = end
    } else if (type === 0x2c && start + 10 < bytes.length) {
      if (u16le(bytes, start + 5) * u16le(bytes, start + 7) > MAX_FRAME_PIXELS) break
      const packed = bytes.charCodeAt(start + 9)
      const localPalette = packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0
      const end = subBlocksEnd(bytes, start + 11 + localPalette)
      if (!end) break
      const poster = `${bytes.slice(0, headerEnd)}${graphicControl}${bytes.slice(start, end)};`
      return `data:image/gif;base64,${btoa(poster)}`
    } else break
  }
  return undefined
}

/** APNG 使用 PNG 默认海报，GIF 保留首帧及其色表、透明度；两者不依赖 canvas 解码。 */
export function embeddedBitmapPoster(url: string, kind: 'gif' | 'apng'): string | undefined {
  try {
    const bytes = atob(url.slice(url.indexOf(',') + 1))
    return kind === 'gif' ? gifPoster(bytes) : pngPoster(bytes)
  } catch {
    return undefined
  }
}
