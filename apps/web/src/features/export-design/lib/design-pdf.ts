import { getMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 已在独立沙盒渲染的一页；Flow 画板可提供连续多页。 */
export interface DesignPdfPage {
  png: Blob
  /** 完整纸页的 CSS 像素宽高；版面保留小数，不使用位图取整后的尺寸。 */
  width: number
  height: number
}

/** 按输入顺序增量嵌入图像；读完所有纸页后才生成可下载的文件。 */
export async function composeDesignPdf(title: string, pages: AsyncIterable<DesignPdfPage>) {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setProducer('Akasha')
  // 浏览器固有视口使用 96 CSS px/in，而 PDF 版面单位是 72 pt/in。
  const pointsPerPixel = 72 / 96
  for await (const { png, width, height } of pages) {
    const image = await pdf.embedPng(await png.arrayBuffer())
    const page = pdf.addPage([width * pointsPerPixel, height * pointsPerPixel])
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
  }
  if (!pdf.getPageCount()) throw new Error(getMessages(messages).t('指定版本没有可导出的画板'))
  const bytes = await pdf.save({ addDefaultPage: false })
  return new Blob(
    [new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)],
    { type: 'application/pdf' },
  )
}
