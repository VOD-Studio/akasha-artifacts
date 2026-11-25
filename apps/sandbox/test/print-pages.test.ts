// @vitest-environment jsdom
import { waitFor } from '@testing-library/react'
import { toSvg } from 'html-to-image'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { createPrintSession } from '../src/capture-print'

vi.mock('html-to-image', () => ({ toSvg: vi.fn(), toBlob: vi.fn() }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function browserProperty(target: object, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, { configurable: true, value })
  onTestFinished(() => {
    if (original) Object.defineProperty(target, name, original)
    else Reflect.deleteProperty(target, name)
  })
}

it('纸宽排版待字体和图像就绪后只冻结一次，普通行完整换页，超高图像的尾部仍在末张', async () => {
  // JSDOM 不计算文字折行；在浏览器几何与位图边界给出已知的行框和超页图像。
  const root = document.createElement('article')
  root.innerHTML = '<p>不能从中间断开的行</p><img loading="lazy" alt="长图">'
  const photo = root.querySelector('img')
  if (!photo) throw new Error('缺少测试内容')
  document.body.append(root)
  onTestFinished(() => root.remove())
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 816, 2630))
  vi.spyOn(photo, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 1200, 300, 1430))
  browserProperty(Range.prototype, 'getClientRects', () => [new DOMRect(10, 1040, 430, 26)])
  const fonts = Promise.withResolvers<void>()
  const imageReady = Promise.withResolvers<void>()
  browserProperty(document, 'fonts', { ready: fonts.promise })
  const decode = vi.fn(() => imageReady.promise)
  browserProperty(photo, 'decode', decode)
  browserProperty(HTMLImageElement.prototype, 'decode', () => Promise.resolve())
  const rasters: Document[] = []
  const drawImage = (image: HTMLImageElement) => {
    const markup = decodeURIComponent(image.src.slice(image.src.indexOf(',') + 1))
    rasters.push(new DOMParser().parseFromString(markup, 'image/svg+xml'))
  }
  browserProperty(HTMLCanvasElement.prototype, 'getContext', () => ({ drawImage }))
  browserProperty(HTMLCanvasElement.prototype, 'toBlob', (done: BlobCallback) =>
    done(new Blob(['page'], { type: 'image/png' })),
  )
  vi.mocked(toSvg).mockResolvedValue(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><title>长图尾部</title></svg>')}`,
  )
  const session = createPrintSession('letter')
  onTestFinished(session.close)
  await expect(session.read(root, 1)).rejects.toThrow('页序')
  const first = session.read(root, 0)
  await expect(session.read(root, 0)).rejects.toThrow('页序')
  expect(decode).not.toHaveBeenCalled()
  fonts.resolve()
  await waitFor(() => expect(decode).toHaveBeenCalledOnce())
  expect(photo.loading).toBe('eager')
  expect(toSvg).not.toHaveBeenCalled()
  imageReady.resolve()
  expect((await first).last).toBe(false)
  expect(rasters).toHaveLength(1)
  expect((await session.read(root, 1)).last).toBe(false)
  expect((await session.read(root, 2)).last).toBe(true)
  await expect(session.read(root, 3)).rejects.toThrow('最后一页')
  expect(toSvg).toHaveBeenCalledOnce()
  expect(
    rasters.map((doc) => doc.documentElement.querySelector('svg')?.getAttribute('viewBox')),
  ).toEqual(['0 0 816 1040', '0 1040 816 1056', '0 2096 816 534'])
  for (const doc of rasters) {
    expect(doc.documentElement.getAttribute('width')).toBe('816')
    expect(doc.documentElement.getAttribute('height')).toBe('1056')
    expect(doc.querySelector('rect')?.getAttribute('fill')).toBe('white')
    expect(doc.querySelector('title')?.textContent).toBe('长图尾部')
  }
})

it('准备资源时取消不生成任何快照或纸张', async () => {
  const fonts = Promise.withResolvers<void>()
  browserProperty(document, 'fonts', { ready: fonts.promise })
  const root = document.createElement('div')
  root.append(document.createElement('p'))
  const session = createPrintSession('a4')
  const page = session.read(root, 0)
  session.close()
  await expect(page).rejects.toHaveProperty('name', 'AbortError')
  fonts.resolve()
  expect(toSvg).not.toHaveBeenCalled()
})

it('作者图片解码失败时拒绝第一页，不用空白替代正文', async () => {
  browserProperty(document, 'fonts', { ready: Promise.resolve() })
  const root = document.createElement('div')
  const photo = document.createElement('img')
  root.append(photo)
  browserProperty(photo, 'decode', () => Promise.reject(new Error('损坏图片')))
  const session = createPrintSession('a4')
  onTestFinished(session.close)
  await expect(session.read(root, 0)).rejects.toThrow('无法加载或解码的图片')
  expect(toSvg).not.toHaveBeenCalled()
})
