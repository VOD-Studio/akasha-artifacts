import { crc32 } from 'node:zlib'
import { zipSync } from 'fflate'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseAgentReference } from '../src/application/agent-reference-reader.js'

const input = (name: string, data: string | Uint8Array) => ({
  name,
  content: Buffer.from(data).toString('base64'),
})

const pkg = 'http://schemas.openxmlformats.org/package/2006'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const ppt = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const drawing = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const format = 'application/vnd.openxmlformats-officedocument'
const relationships = (body: string) =>
  `<Relationships xmlns="${pkg}/relationships">${body}</Relationships>`
const link = (id: string, type: string, path: string) =>
  `<Relationship Id="${id}" Type="${office}/${type}" Target="${path}"/>`
const types = (parts: Record<string, string>) =>
  `<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>${Object.entries(
    parts,
  )
    .map(([name, kind]) => `<Override PartName="/${name}" ContentType="${format}.${kind}+xml"/>`)
    .join('')}</Types>`
const archive = (parts: Record<string, string>) =>
  zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, Buffer.from(xml)])))
const docParts = (xml: string) => ({
  '[Content_Types].xml': types({ 'word/document.xml': 'wordprocessingml.document.main' }),
  '_rels/.rels': relationships(link('doc', 'officeDocument', 'word/document.xml')),
  'word/document.xml': xml,
})
const document = (text: string) =>
  `<w:document xmlns:w="${word}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
const slide = (text: string) => `<p:sld xmlns:p="${ppt}" xmlns:a="${drawing}">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
const slides = () => ({
  '[Content_Types].xml': types({
    'ppt/presentation.xml': 'presentationml.presentation.main',
    'ppt/slides/slide1.xml': 'presentationml.slide',
    'ppt/slides/slide2.xml': 'presentationml.slide',
  }),
  '_rels/.rels': relationships(link('ppt', 'officeDocument', 'ppt/presentation.xml')),
  'ppt/presentation.xml': `<p:presentation xmlns:p="${ppt}" xmlns:r="${office}"><p:sldIdLst>
    <p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>`,
  'ppt/_rels/presentation.xml.rels': relationships(
    link('first', 'slide', 'slides/slide1.xml') + link('second', 'slide', 'slides/slide2.xml'),
  ),
  'ppt/slides/slide1.xml': slide('终点'),
  'ppt/slides/slide2.xml': slide('起点'),
  'ppt/notesSlides/notesSlide1.xml': '<unused>不送出备注</unused>',
})

const badRequest = { name: 'DomainError', code: 'BAD_REQUEST' }

describe('受限轮次参考材料', () => {
  it('按原始字节摘要；设计文件按 UTF-8 预览', async () => {
    const result = await parseAgentReference(input('说明.md', 'abc'))
    expect(result).toEqual({
      summary: {
        name: '说明.md',
        kind: 'design',
        bytes: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      },
      text: 'abc',
    })
    const json = '{"标记":"海蓝"}'
    expect((await parseAgentReference(input('令牌.json', json))).text).toBe(json)
  })

  it.each([
    ['样式.css', '@import url("https://example.invalid/theme.css");'],
    ['按钮.tsx', 'import type { Theme } from "./private"; export const el = <button />;'],
    ['卡片.jsx', 'throw new Error("不可执行"); export default <article />;'],
  ])('设计源码 %s 仅作为原文交付，不加载依赖或执行', async (name, source) => {
    const ref = await parseAgentReference(input(name, source))
    expect(ref.summary.kind).toBe('design')
    expect(ref.text).toBe(source)
    await expect(parseAgentReference(input(name, Uint8Array.of(0xff)))).rejects.toMatchObject(
      badRequest,
    )
  })

  it('在 24 KiB 的前缀边界保留完整 Unicode 字符，仍验证前缀之后的内容', async () => {
    const prefix = 'a'.repeat(24 * 1024 - 1)
    expect((await parseAgentReference(input('内容.txt', `${prefix}蓝x`))).text).toBe(prefix)
    await expect(parseAgentReference(input('坏.json', `"${prefix}"x`))).rejects.toMatchObject(
      badRequest,
    )
  })

  it.each(['png', 'jpeg'] as const)('解码 %s 像素但轮次取得原文件', async (format) => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#159fdd' },
    })
      [format]()
      .toBuffer()
    const file = `截图.${format}`
    const result = await parseAgentReference(input(file, bytes))
    expect(result.summary).toMatchObject({ name: file, bytes: bytes.length, kind: 'image' })
    expect(result.image?.extension).toBe(format === 'jpeg' ? 'jpg' : 'png')
    expect(Buffer.from(result.image?.bytes ?? [])).toEqual(bytes)
    await expect(parseAgentReference(input(file, bytes.subarray(0, -18)))).rejects.toMatchObject(
      badRequest,
    )
    await expect(
      parseAgentReference(input(format === 'jpeg' ? '伪装.png' : '伪装.jpg', bytes)),
    ).rejects.toMatchObject(badRequest)
  })

  it('PNG 块校验正确、JPEG 扫描头完整仍不能代替实际像素解码', async () => {
    const image = sharp({ create: { width: 32, height: 32, channels: 3, background: '#321' } })
    const png = await image.clone().png().toBuffer()
    const idat = png.indexOf('IDAT')
    const crc = idat + 4 + png.readUInt32BE(idat - 4)
    png[idat + 4] = 0
    png.writeUInt32BE(crc32(png.subarray(idat, crc)), crc)
    await expect(parseAgentReference(input('坏像素.png', png))).rejects.toMatchObject(badRequest)

    const jpeg = await image.jpeg().toBuffer()
    const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]))
    const header = jpeg.subarray(0, scan + 2 + jpeg.readUInt16BE(scan + 2))
    const withoutPixels = Buffer.concat([header, jpeg.subarray(-2)])
    await expect(parseAgentReference(input('坏扫描.jpg', withoutPixels))).rejects.toMatchObject(
      badRequest,
    )
  })

  it('DOCX 提取正文而非整包文字，也不解引用超链接', async () => {
    const bytes = archive({
      ...docParts(document('甲 &amp; 乙')),
      'word/_rels/document.xml.rels': relationships(
        `<Relationship Id="r2" Type="${office}/hyperlink" TargetMode="External" Target="https://example.invalid/private"/>`,
      ),
      'word/comments.xml': '<unused>不送出批注</unused>',
    })
    const ref = await parseAgentReference(input('需求.docx', bytes))
    expect(ref.summary.kind).toBe('document')
    expect(ref.text).toBe('甲 & 乙')
  })

  it('PPTX 根据演示顺序读取幻灯片，而非包内文件名或备注', async () => {
    const ref = await parseAgentReference(input('流程.pptx', archive(slides())))
    expect(ref.summary.kind).toBe('slides')
    expect(ref.text).toBe('起点\n终点')
  })

  it.each(['YQ', 'YQ==\n', 'YR==', 'YQ____==', '%%%', ''])('拒绝非规范 base64 %j', async (s) => {
    await expect(parseAgentReference({ name: '需求.txt', content: s })).rejects.toMatchObject(
      badRequest,
    )
  })

  it.each([
    input('太大.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)),
    input('无效.txt', Uint8Array.of(0xc0, 0x80)),
    input('伪装.md', '二进制\u0000'),
    input('跳转.url', 'https://example.invalid/file'),
    input('../越权.txt', 'abc'),
    input('假.docx', archive({ 'word/document.xml': document('文字') })),
    input('混淆.docx', archive(slides())),
    input('损坏.docx', archive(docParts(document('<broken>')))),
    input('过深.docx', archive(docParts(document(`${'<n>'.repeat(300)}x${'</n>'.repeat(300)}`)))),
    input('压缩膨胀.docx', archive(docParts(document('x'.repeat(4 * 1024 * 1024))))),
    input(
      '条目过多.docx',
      archive({
        ...docParts(document('正文')),
        ...Object.fromEntries(Array.from({ length: 512 }, (_, i) => [`media/${i}`, ''])),
      }),
    ),
    input(
      '实体.docx',
      archive(docParts(`<!DOCTYPE d [<!ENTITY sample "x">]>${document('&sample;')}`)),
    ),
    input(
      '外部.pptx',
      archive({
        ...slides(),
        'ppt/_rels/presentation.xml.rels': relationships(
          `<Relationship Id="second" Type="${office}/slide" TargetMode="External" Target="file:///private/slide.xml"/>`,
        ),
      }),
    ),
  ])('拒绝不可交付的材料：$name', async (file) => {
    await expect(parseAgentReference(file)).rejects.toMatchObject(badRequest)
  })
})
