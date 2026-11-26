import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { crc32 } from 'node:zlib'
import {
  AGENT_REFERENCE_BYTES,
  type AgentReferenceInput,
  AgentReferenceInputSchema,
  type AgentReferenceSummary,
} from '@akasha/protocol'
import { DomainError } from '../domain/errors.js'
import { extractOfficeReference } from './agent-reference-office.js'

/** 图片保留原始字节；文字材料只交付实际预览过的有界 UTF-8 正文。 */
export interface ParsedAgentReference {
  summary: AgentReferenceSummary
  text?: string
  image?: { bytes: Uint8Array; extension: 'png' | 'jpg' }
}

const MAX_TEXT_BYTES = 24 * 1024
const MAX_PIXELS = 16 * 1024 * 1024
const designExtensions: Record<string, true> = {
  '.md': true,
  '.txt': true,
  '.json': true,
  '.css': true,
  '.tsx': true,
  '.jsx': true,
}
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')
const invalidImage = () => new DomainError('BAD_REQUEST', '图片损坏或与扩展名不符')

function validatePng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(pngSignature)) throw invalidImage()
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset)
    const end = offset + 8 + size
    if (end + 4 > bytes.length) throw invalidImage()
    const chunk = bytes.subarray(offset + 4, end)
    if (crc32(chunk) !== bytes.readUInt32BE(end)) throw invalidImage()
    const type = chunk.toString('ascii', 0, 4)
    // 像素解码器只校验 PNG 的静态图，不能把未解码的动画帧一并交给轮次。
    if (type === 'acTL') throw new DomainError('BAD_REQUEST', '请将动画导出为静态 PNG 或 JPEG')
    if (type === 'IEND') {
      if (size !== 0 || end + 4 !== bytes.length) throw invalidImage()
      return
    }
    offset = end + 4
  }
  throw invalidImage()
}

async function decodeImage(bytes: Buffer, extension: 'png' | 'jpg') {
  if (extension === 'png') {
    validatePng(bytes)
  } else if (
    bytes.length < 4 ||
    bytes.readUInt16BE(0) !== 0xffd8 ||
    bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
  ) {
    throw invalidImage()
  }
  // sharp 的原生解码器因平台而异；不支持该平台时，非图片材料仍应能使用工作台。
  const { default: sharp } = await import('sharp')
  // 只读取尺寸不能发现损坏的扫描数据；灰度输出限制校验时生成的像素缓冲区。
  const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
  const info = await image.metadata()
  if (info.format !== (extension === 'jpg' ? 'jpeg' : 'png') || (info.pages ?? 1) !== 1) {
    throw invalidImage()
  }
  await image.removeAlpha().greyscale().raw({ depth: 'uchar' }).toBuffer()
}

function decodeDesign(bytes: Buffer, json: boolean) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)) {
      throw new DomainError('BAD_REQUEST', '设计资料必须是有效的 UTF-8 文本')
    }
  }
  if (json) JSON.parse(text)
  return text
}

/** 校验原始材料并生成与轮次一致的预览；不打开路径或 URL，解析失败返回 BAD_REQUEST。 */
export async function parseAgentReference(
  input: AgentReferenceInput,
): Promise<ParsedAgentReference> {
  try {
    const { name, content } = AgentReferenceInputSchema.parse(input)
    const bytes = Buffer.from(content, 'base64')
    // Node 会容忍空白、URL 编码和非零填充位；回编码一致才是规范的标准 base64。
    if (
      !bytes.length ||
      bytes.length > AGENT_REFERENCE_BYTES ||
      bytes.toString('base64') !== content
    ) {
      throw new DomainError('BAD_REQUEST', '参考材料超过 2 MiB 或不是规范的 base64')
    }
    const ext = extname(name).toLowerCase()
    const summary = (kind: AgentReferenceSummary['kind']): AgentReferenceSummary => ({
      name,
      kind,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const extension = ext === '.png' ? 'png' : 'jpg'
      await decodeImage(bytes, extension)
      return { summary: summary('image'), image: { bytes, extension } }
    }
    const output = Buffer.allocUnsafe(MAX_TEXT_BYTES)
    const encoder = new TextEncoder()
    let written = 0
    let full = false
    const append = (value: string) => {
      if (full) return
      const chunk = encoder.encodeInto(value, output.subarray(written))
      written += chunk.written
      full = chunk.read < value.length || written === MAX_TEXT_BYTES
    }
    let kind: AgentReferenceSummary['kind']
    if (ext === '.docx' || ext === '.pptx') {
      kind = ext === '.docx' ? 'document' : 'slides'
      await extractOfficeReference(bytes, ext === '.pptx', append)
    } else if (Object.hasOwn(designExtensions, ext)) {
      kind = 'design'
      append(decodeDesign(bytes, ext === '.json'))
    } else {
      throw new DomainError(
        'BAD_REQUEST',
        '请使用 PNG、JPEG、DOCX、PPTX、Markdown、TXT、JSON、CSS、TSX 或 JSX 文件',
      )
    }
    let text = output.toString('utf8', 0, written)
    if (kind !== 'design') text = text.trimEnd()
    if (!text.trim()) throw new DomainError('BAD_REQUEST', '参考材料没有可交付的正文')
    return { summary: summary(kind), text }
  } catch (error) {
    if (error instanceof DomainError) throw error
    throw new DomainError('BAD_REQUEST', '参考材料无法解析，请重新导出后再试')
  }
}
