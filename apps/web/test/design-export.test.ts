import { PDFDocument } from 'pdf-lib'
import { expect, it } from 'vitest'
import { composeDesignPdf } from '../src/features/export-design/design-pdf'

const png = new Blob(
  [
    Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1UAAAAASUVORK5CYII=',
      ),
      (char) => char.charCodeAt(0),
    ),
  ],
  { type: 'image/png' },
)

it('把指定顺序的宽屏、移动屏和状态板输出为各自尺寸的 PDF 页', async () => {
  async function* pages() {
    yield { png, width: 720, height: 520 }
    yield { png, width: 360, height: 640 }
    yield { png, width: 500, height: 400 }
  }
  const file = await composeDesignPdf('预订流程 · v3', pages())
  const parsed = await PDFDocument.load(await file.arrayBuffer())
  expect(parsed.getTitle()).toBe('预订流程 · v3')
  expect(parsed.getPages().map((page) => page.getSize())).toEqual([
    { width: 540, height: 390 },
    { width: 270, height: 480 },
    { width: 375, height: 300 },
  ])
})

it('中途有一张画板无法渲染时，不返回只含前几页的下载文件', async () => {
  async function* pages() {
    yield { png, width: 720, height: 520 }
    throw new Error('手机画板有未加载的图片')
  }
  await expect(composeDesignPdf('预订流程 · v3', pages())).rejects.toThrow('手机画板有未加载的图片')
})
