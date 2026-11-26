import { posix } from 'node:path'
import { buffer } from 'node:stream/consumers'
import { crc32 } from 'node:zlib'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import { type Entry, fromBufferPromise } from 'yauzl'
import { DomainError } from '../domain/errors.js'

const MAX_ENTRIES = 512
const MAX_UNPACKED_BYTES = 16 * 1024 * 1024
const MAX_XML_BYTES = 2 * 1024 * 1024
const packageNs = 'http://schemas.openxmlformats.org/package/2006'
const schemas = 'http://schemas.openxmlformats.org'
const strict = 'http://purl.oclc.org/ooxml'
const relNs = new Set([
  `${schemas}/officeDocument/2006/relationships`,
  `${strict}/officeDocument/relationships`,
])
const wordNs = new Set([`${schemas}/wordprocessingml/2006/main`, `${strict}/wordprocessingml/main`])
const slideNs = new Set([`${schemas}/presentationml/2006/main`, `${strict}/presentationml/main`])
const drawNs = new Set([`${schemas}/drawingml/2006/main`, `${strict}/drawingml/main`])
const mime = 'application/vnd.openxmlformats-officedocument.'
const invalid = () => new DomainError('BAD_REQUEST', '文档或演示的结构无效，或超过了解析限制')

interface XmlVisitor {
  open?: (tag: SaxesTagNS, parent: SaxesTagNS | undefined) => void
  close?: (tag: SaxesTagNS) => void
  text?: (value: string, tag: SaxesTagNS) => void
}

function parseXml(bytes: Buffer, root: string, xmlns: string | Set<string>, visitor: XmlVisitor) {
  const parser = new SaxesParser({ xmlns: true })
  const stack: SaxesTagNS[] = []
  let nodes = 0
  let attributes = 0
  parser.on('doctype', () => {
    throw invalid()
  })
  parser.on('opentagstart', () => {
    attributes = 0
    if (++nodes > 100_000 || stack.length >= 96) throw invalid()
  })
  parser.on('attribute', () => {
    if (++attributes > 128) throw invalid()
  })
  parser.on('opentag', (tag) => {
    if (!stack.length) {
      const matches = typeof xmlns === 'string' ? tag.uri === xmlns : xmlns.has(tag.uri)
      if (tag.local !== root || !matches) throw invalid()
    }
    visitor.open?.(tag, stack.at(-1))
    stack.push(tag)
  })
  parser.on('closetag', (tag) => {
    visitor.close?.(tag)
    stack.pop()
  })
  if (visitor.text) {
    const text = (value: string) => {
      const tag = stack.at(-1)
      if (tag) visitor.text?.(value, tag)
    }
    parser.on('text', text)
    parser.on('cdata', text)
  }
  let encoding = 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
  parser.write(new TextDecoder(encoding, { fatal: true }).decode(bytes)).close()
}

function relatedParts(bytes: Buffer, source: string, type: string) {
  const parts = new Map<string, string>()
  parseXml(bytes, 'Relationships', `${packageNs}/relationships`, {
    open(tag, parent) {
      if (
        parent?.local !== 'Relationships' ||
        parent.uri !== tag.uri ||
        tag.local !== 'Relationship'
      )
        return
      const attrs = tag.attributes
      const uri = attrs.Type?.value ?? ''
      const slash = uri.lastIndexOf('/')
      if (!relNs.has(uri.slice(0, slash)) || uri.slice(slash + 1) !== type) return
      const target = attrs.Target?.value
      const id = attrs.Id?.value
      if (
        !target ||
        !id ||
        parts.has(id) ||
        (attrs.TargetMode?.value ?? 'Internal') !== 'Internal'
      ) {
        throw invalid()
      }
      // 只索引本 ZIP 内的部件，既不在磁盘上拼路径，也不解析网络地址。
      if (/[:?#\\]/.test(target) || target.startsWith('//')) throw invalid()
      const path = target.startsWith('/')
        ? posix.normalize(target).slice(1)
        : posix.join(posix.dirname(source), target)
      if (path.startsWith('../') || path === '..') throw invalid()
      parts.set(id, path)
    },
  })
  return parts
}

function contentTypes(bytes: Buffer) {
  const types = new Map<string, string>()
  parseXml(bytes, 'Types', `${packageNs}/content-types`, {
    open(tag, parent) {
      if (parent?.local !== 'Types' || parent.uri !== tag.uri) return
      let key: string | undefined
      if (tag.local === 'Override') key = tag.attributes.PartName?.value
      if (tag.local === 'Default') key = tag.attributes.Extension?.value.toLowerCase()
      if (!key) return
      const type = tag.attributes.ContentType?.value
      if (!type || types.has(key)) throw invalid()
      types.set(key, type)
    },
  })
  return types
}

function extractText(bytes: Buffer, slides: boolean, append: (text: string) => void) {
  const textNs = slides ? drawNs : wordNs
  const rootNs = slides ? slideNs : wordNs
  const body = slides ? 'cSld' : 'body'
  let inBody = false
  parseXml(bytes, slides ? 'sld' : 'document', rootNs, {
    open(tag) {
      if (tag.local === body && rootNs.has(tag.uri)) inBody = true
      if (!inBody || !textNs.has(tag.uri)) return
      if (tag.local === 'tab') append('\t')
      if (tag.local === 'br' || tag.local === 'cr') append('\n')
    },
    text(value, tag) {
      if (inBody && tag.local === 't' && textNs.has(tag.uri)) append(value)
    },
    close(tag) {
      if (inBody && tag.local === 'p' && textNs.has(tag.uri)) append('\n')
      if (tag.local === body && rootNs.has(tag.uri)) inBody = false
    },
  })
}

/** 按包内清单与关系读取正文或有序幻灯片；不解包附件、备注和外部关系。 */
export async function extractOfficeReference(
  bytes: Buffer,
  slides: boolean,
  append: (text: string) => void,
) {
  const zip = await fromBufferPromise(bytes, { autoClose: false, strictFileNames: true })
  try {
    if (zip.entryCount > MAX_ENTRIES) throw invalid()
    const entries = new Map<string, Entry>()
    let total = 0
    for await (const entry of zip.eachEntry()) {
      total += entry.uncompressedSize
      if (
        !Number.isSafeInteger(total) ||
        total > MAX_UNPACKED_BYTES ||
        entries.has(entry.fileName)
      ) {
        throw invalid()
      }
      entries.set(entry.fileName, entry)
    }
    const read = async (name: string) => {
      const entry = entries.get(name)
      if (!entry || entry.uncompressedSize > MAX_XML_BYTES || !entry.canDecodeFileData())
        throw invalid()
      // 每个部件至多解压一次；yauzl 在流中核对实际输出字节数，不能只信中央目录。
      entries.delete(name)
      const data = await buffer(await zip.openReadStreamPromise(entry))
      if (crc32(data) !== entry.crc32) throw invalid()
      return data
    }
    const types = contentTypes(await read('[Content_Types].xml'))
    const main = relatedParts(await read('_rels/.rels'), '', 'officeDocument')
    if (main.size !== 1) throw invalid()
    const [part] = main.values()
    const typeOf = (name: string) =>
      types.get(`/${name}`) ?? types.get(posix.extname(name).slice(1).toLowerCase())
    const expected = slides ? 'presentationml.presentation.main' : 'wordprocessingml.document.main'
    if (typeOf(part) !== `${mime}${expected}+xml`) throw invalid()
    const body = await read(part)
    if (!slides) {
      extractText(body, false, append)
      return
    }
    const slideIds: string[] = []
    parseXml(body, 'presentation', slideNs, {
      open(tag, parent) {
        if (
          tag.local !== 'sldId' ||
          !slideNs.has(tag.uri) ||
          parent?.local !== 'sldIdLst' ||
          parent.uri !== tag.uri
        )
          return
        const id = Object.values(tag.attributes).find((a) => a.local === 'id' && relNs.has(a.uri))
        if (!id || slideIds.length >= MAX_ENTRIES) throw invalid()
        slideIds.push(id.value)
      },
    })
    const rels = posix.join(posix.dirname(part), '_rels', `${posix.basename(part)}.rels`)
    const parts = relatedParts(await read(rels), part, 'slide')
    for (const id of slideIds) {
      const name = parts.get(id)
      if (!name || typeOf(name) !== `${mime}presentationml.slide+xml`) throw invalid()
      extractText(await read(name), true, append)
    }
  } finally {
    zip.close()
  }
}
