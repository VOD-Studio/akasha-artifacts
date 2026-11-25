import { getArtboardPaperSize } from '@akasha/protocol'
import { PDFDocument } from 'pdf-lib'
import { expect, it } from 'vitest'
import { composeDesignPdf } from '../src/features/export-design/lib/design-pdf'

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

async function* mixedPages() {
  yield { png, width: 720, height: 520 }
  yield { png, width: 360, height: 640 }
  yield { png, width: 500, height: 400 }
  yield { png, ...getArtboardPaperSize('a4') }
  yield { png, ...getArtboardPaperSize('letter') }
}

it('混排时按画板、A4 和 Letter 的实际尺寸写入各页 MediaBox', async () => {
  const file = await composeDesignPdf('预订流程 · v3', mixedPages())
  const parsed = await PDFDocument.load(await file.arrayBuffer())
  expect(parsed.getTitle()).toBe('预订流程 · v3')
  const [board, mobile, state, a4, letter] = parsed.getPages().map((page) => page.getMediaBox())
  expect(board).toEqual({ x: 0, y: 0, width: 540, height: 390 })
  expect(mobile).toEqual({ x: 0, y: 0, width: 270, height: 480 })
  expect(state).toEqual({ x: 0, y: 0, width: 375, height: 300 })
  expect(a4?.width).toBeCloseTo(595.27559055, 6)
  expect(a4?.height).toBeCloseTo(841.88976378, 6)
  expect(letter).toEqual({ x: 0, y: 0, width: 612, height: 792 })
})

it('中途有一张画板无法渲染时，不返回只含前几页的下载文件', async () => {
  async function* pages() {
    yield { png, width: 720, height: 520 }
    throw new Error('手机画板有未加载的图片')
  }
  await expect(composeDesignPdf('预订流程 · v3', pages())).rejects.toThrow('手机画板有未加载的图片')
})
