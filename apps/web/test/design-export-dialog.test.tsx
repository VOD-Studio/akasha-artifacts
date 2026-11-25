// @vitest-environment jsdom
import {
  type Artifact,
  PROTOCOL_VERSION,
  ShellToSandboxMessageSchema,
  type Version,
} from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { strFromU8, unzipSync, unzlibSync } from 'fflate'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { ArtifactExportDialog } from '../src/features/export-design'
import * as capture from '../src/shared/bridge/capture-png'
import { setLocale } from '../src/shared/i18n'

const now = '2026-11-22T10:00:00.000Z'
const artifact: Artifact = {
  publicId: 'DesignExportProtected001',
  projectId: 'protected-design',
  slug: 'design/plan',
  title: '受保护的设计',
  type: 'html',
  visibility: 'private',
  headVersion: 4,
  createdAt: now,
  updatedAt: now,
}
const version: Version = {
  artifactId: artifact.publicId,
  version: 2,
  parentVersion: 1,
  author: 'agent:cli',
  title: artifact.title,
  source: '<h1>先前读取的内容</h1>',
  createdAt: now,
}

const liveDownloadUrls = new Set<string>()

afterEach(async () => {
  cleanup()
  try {
    await waitFor(() => expect(liveDownloadUrls.size).toBe(0), { timeout: 3000 })
  } finally {
    liveDownloadUrls.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('确认下载时必须重新读取面板中的固定版本，权限失效不渲染已缓存的内容', async () => {
  const request = vi
    .spyOn(window, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { code: 'FORBIDDEN', message: '该快照不再允许读取' } },
        { status: 403 },
      ),
    )
  render(
    <ArtifactExportDialog target={{ artifact, version, boardId: 'main' }} onClose={() => {}} />,
  )
  expect(screen.getByRole('combobox', { name: '导出范围' }).textContent).toBe(version.title)
  expect(screen.getByRole('radio', { name: 'PNG' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  expect((await screen.findByRole('alert')).textContent).toContain('该快照不再允许读取')
  expect(request).toHaveBeenCalledWith(
    `/api/v1/artifacts/${artifact.publicId}?version=2`,
    expect.objectContaining({ credentials: 'include' }),
  )
  expect(screen.queryByTitle('画板渲染任务')).toBeNull()
})

const artboard = { ...artifact, type: 'artboard' as const }
const pinned = {
  ...version,
  source: JSON.stringify({
    columns: 2,
    pages: [{ id: 'flow', title: '预订' }],
    boards: [
      {
        id: 'finish',
        title: '完成',
        pageId: 'flow',
        position: { x: 100, y: 650 },
        viewport: { width: 400, height: 280 },
      },
      {
        id: 'other',
        title: '备选',
        pageId: 'flow',
        position: { x: 900, y: 20 },
        viewport: { width: 500, height: 400 },
      },
      {
        id: 'start',
        title: '首页',
        pageId: 'flow',
        printLayout: { mode: 'flow', paper: 'a4' },
        viewport: { width: 720, height: 520 },
      },
    ],
  }),
}

function trackDownloads() {
  // jsdom 的 Blob 没有 arrayBuffer；通过同一文档的 FileReader 读取真实字节。
  if (!Blob.prototype.arrayBuffer) {
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: Blob) {
        const reader = new FileReader()
        const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>()
        reader.onload = () => {
          if (reader.result === null || typeof reader.result === 'string')
            reject(new Error('未读取到二进制数据'))
          else resolve(reader.result)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
        return promise
      },
    })
    onTestFinished(() => {
      Reflect.deleteProperty(Blob.prototype, 'arrayBuffer')
    })
  }
  const blobs: Blob[] = []
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL(file: Blob) {
        blobs.push(file)
        const url = `blob:http://localhost/design-${blobs.length}`
        liveDownloadUrls.add(url)
        return url
      }
      static revokeObjectURL(url: string) {
        liveDownloadUrls.delete(url)
      }
    },
  )
  const names: string[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  vi.spyOn(window, 'fetch').mockImplementation(async () =>
    Response.json({ artifact: artboard, version: pinned }),
  )
  return { blobs, names }
}

function pngFixture(base64: string) {
  return new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], {
    type: 'image/png',
  })
}

async function replyFromPngSandbox(scale: number, png: Blob) {
  const frame = await screen.findByTitle<HTMLIFrameElement>('画板渲染任务')
  const host = frame.contentWindow
  if (!host) throw new Error('导出沙盒未启动')
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')
  const send = (message: Record<string, unknown>) => {
    fireEvent(
      window,
      new MessageEvent('message', {
        source: host,
        origin: 'null',
        data: { ...message, v: PROTOCOL_VERSION, nonce },
      }),
    )
  }
  const post = vi.spyOn(host, 'postMessage').mockImplementation(() => {})
  send({ type: 'ready' })
  send({ type: 'rendered', version: pinned.version })
  const request = ShellToSandboxMessageSchema.parse(post.mock.calls.at(-1)?.[0])
  expect(request).toMatchObject({
    type: 'capture.png',
    version: pinned.version,
    width: 720,
    height: 520,
    scale,
  })
  send({ type: 'capture.png.result', version: pinned.version, png })
}

it('单板 PNG 倍率改变输出像素，但不改变固有布局或固定版本', async () => {
  const { names, blobs } = trackDownloads()
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      locks: {
        value: {
          request: (_name: string, _options: LockOptions, render: () => Promise<Blob>) => render(),
        },
      },
    }),
  )
  vi.stubGlobal('devicePixelRatio', 3)
  const one = pngFixture(
    'iVBORw0KGgoAAAANSUhEUgAAAtAAAAIIAQAAAABvQeRzAAAARUlEQVR42u3BMQEAAADCoPVPbQsvoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAICXAbjYAAGnmxqfAAAAAElFTkSuQmCC',
  )
  const two = pngFixture(
    'iVBORw0KGgoAAAANSUhEUgAABaAAAAQQAQAAAAA8ZsGkAAAAzUlEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeDbfbgABBCPjNgAAAABJRU5ErkJggg==',
  )
  render(
    <ArtifactExportDialog
      target={{ artifact: artboard, version: pinned, boardId: 'start' }}
      onClose={() => {}}
    />,
  )
  const size = screen.getByLabelText('输出像素尺寸')
  expect(size.textContent).toBe('720 × 520 像素')
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await replyFromPngSandbox(1, one)
  await waitFor(() => expect(names).toEqual(['受保护的设计-v2-首页.png']))
  fireEvent.click(screen.getByRole('radio', { name: '2×' }))
  expect(size.textContent).toBe('1440 × 1040 像素')
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await replyFromPngSandbox(2, one)
  expect((await screen.findByRole('alert')).textContent).toContain('PNG 格式或尺寸不符')
  expect(names).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await replyFromPngSandbox(2, two)
  await waitFor(() => expect(names[1]).toBe('受保护的设计-v2-首页@2x.png'))
  const dimensions = await Promise.all(
    blobs.map(async (blob) => {
      const header = new DataView(await blob.arrayBuffer())
      return [header.getUint32(16), header.getUint32(20)]
    }),
  )
  expect(dimensions).toEqual([
    [720, 520],
    [1440, 1040],
  ])
})

const blackPixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'
const whitePixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'

async function* fixturePrintPages(
  board: Parameters<typeof capture.captureBoardPrintPages>[0],
  first: Blob,
  last: Blob,
  fail = false,
) {
  if (board.printLayout?.mode !== 'flow') {
    yield { png: first, width: board.width, height: board.height }
    return
  }
  const paper = { width: (210 / 25.4) * 96, height: (297 / 25.4) * 96 }
  yield { png: first, ...paper }
  if (fail) throw new Error('图片未加载')
  yield { png: last, ...paper }
}

it('选区打印预览与下载使用相同的纸页：保留板序、实际图像及 Fixed/A4 MediaBox', async () => {
  const { names, blobs } = trackDownloads()
  const png = pngFixture(blackPixel)
  const end = pngFixture(whitePixel)
  let fail = true
  const rasterize = vi
    .spyOn(capture, 'captureBoardPrintPages')
    .mockImplementation((board) => fixturePrintPages(board, png, end, fail))
  const selection = {
    artifactId: artifact.publicId,
    version: 2,
    pageId: 'flow',
    columns: 1,
    boardIds: ['start', 'finish'],
  }
  render(
    <ArtifactExportDialog
      target={{ artifact: artboard, version: pinned, boardId: 'other', selection }}
      onClose={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('combobox', { name: '导出范围' }))
  fireEvent.click(screen.getByRole('option', { name: '选中画板（2 张）' }))
  expect(screen.queryByRole('radio', { name: 'PNG' })).toBeNull()
  expect(screen.getAllByRole('radio')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  expect((await screen.findByRole('alert')).textContent).toContain('「首页」：图片未加载')
  expect(names).toEqual([])
  fail = false
  fireEvent.click(screen.getByRole('button', { name: '打印预览' }))
  const first = await screen.findByRole<HTMLImageElement>('img', { name: '第 1 页，共 3 页' })
  await waitFor(() => expect(first.src).toContain('blob:'))
  expect(blobs.at(-1)).toBe(png)
  const firstUrl = first.src
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(screen.getByRole('img', { name: '第 3 页，共 3 页' })).toBeTruthy()
  expect(liveDownloadUrls.has(firstUrl)).toBe(false)
  expect(blobs.at(-1)).toBe(end)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await waitFor(() => expect(names).toEqual(['受保护的设计-v2-选区.pdf']))
  expect(rasterize.mock.calls.map(([board]) => board.id)).toEqual([
    'finish',
    'start',
    'finish',
    'start',
  ])
  const file = blobs.at(-1)
  if (!file) throw new Error('没有收到 PDF 下载')
  const pdf = await PDFDocument.load(await file.arrayBuffer())
  const [fixed, a4, last] = pdf.getPages()
  expect(fixed?.getMediaBox()).toEqual({ x: 0, y: 0, width: 300, height: 210 })
  expect(a4?.getWidth()).toBeCloseTo(595.27559055, 6)
  expect(a4?.getHeight()).toBeCloseTo(841.88976378, 6)
  expect(last?.getMediaBox()).toEqual(a4?.getMediaBox())
  const colors = pdf.getPages().map((page) => {
    const objects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
    const reference = objects?.entries()[0]?.[1]
    if (!reference) throw new Error('纸页没有图像')
    const image = pdf.context.lookup(reference)
    if (!(image instanceof PDFRawStream)) throw new Error('纸页图像不是可解码的数据流')
    return Array.from(unzlibSync(image.getContents()))
  })
  expect(colors).toEqual([
    [0, 0, 0],
    [0, 0, 0],
    [255, 255, 255],
  ])
})

it('范围和固定版本切换清理预览；复核下载权限失败不交付预览过的 PDF', async () => {
  const { names } = trackDownloads()
  const png = pngFixture(blackPixel)
  const rasterize = vi
    .spyOn(capture, 'captureBoardPrintPages')
    .mockImplementation((board) => fixturePrintPages(board, png, png))
  setLocale('en')
  onTestFinished(() => setLocale('zh-CN'))
  const view = render(
    <ArtifactExportDialog target={{ artifact: artboard, version: pinned }} onClose={cleanup} />,
  )
  const openPreview = () => fireEvent.click(screen.getByRole('button', { name: 'Print preview' }))
  expect(rasterize).not.toHaveBeenCalled()
  openPreview()
  await screen.findByRole('img', { name: 'Page 1 of 4' })
  expect(rasterize.mock.calls.map(([board]) => board.id)).toEqual(['finish', 'other', 'start'])
  fireEvent.click(screen.getByRole('combobox', { name: 'Export scope' }))
  fireEvent.click(screen.getByRole('option', { name: '首页' }))
  expect(screen.queryByRole('img')).toBeNull()
  expect(liveDownloadUrls.size).toBe(0)
  fireEvent.click(screen.getByRole('radio', { name: 'PDF' }))
  openPreview()
  await screen.findByRole('img', { name: 'Page 1 of 2' })
  vi.mocked(window.fetch).mockResolvedValueOnce(
    Response.json({ error: { code: 'FORBIDDEN', message: '不可读取' } }, { status: 403 }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Export' }))
  await screen.findByRole('alert')
  expect(screen.queryByRole('img')).toBeNull()
  expect(liveDownloadUrls.size).toBe(0)
  expect(names).toEqual([])
  openPreview()
  await screen.findByRole('img', { name: 'Page 1 of 2' })
  view.rerender(
    <ArtifactExportDialog
      target={{ artifact: artboard, version: { ...pinned, version: 3 } }}
      onClose={cleanup}
    />,
  )
  expect(screen.queryByRole('img')).toBeNull()
  expect(liveDownloadUrls.size).toBe(0)
  openPreview()
  expect((await screen.findByRole('alert')).textContent).toContain('specified version')
  expect(rasterize).toHaveBeenCalledTimes(5)
})

async function* delayedPrintPages(png: Blob, waitForNext: () => Promise<void>) {
  yield { png, width: 720, height: 520 }
  await waitForNext()
  yield { png, width: 720, height: 520 }
}

it.each(['取消', '切换版本'])(
  '%s使未完成的打印预览失效，迟到的纸页不再显示或下载',
  async (action) => {
    const { blobs, names } = trackDownloads()
    const waiting = Promise.withResolvers<void>()
    const next = Promise.withResolvers<void>()
    const waitForNext = () => {
      waiting.resolve()
      return next.promise
    }
    const png = pngFixture(blackPixel)
    const rasterize = vi
      .spyOn(capture, 'captureBoardPrintPages')
      .mockImplementation(() => delayedPrintPages(png, waitForNext))
    const view = render(
      <ArtifactExportDialog target={{ artifact: artboard, version: pinned }} onClose={cleanup} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '打印预览' }))
    await waiting.promise
    expect(screen.queryByRole('img')).toBeNull()
    if (action === '取消') fireEvent.click(screen.getByRole('button', { name: '取消' }))
    else
      view.rerender(
        <ArtifactExportDialog
          target={{ artifact: artboard, version: { ...pinned, version: 3 } }}
          onClose={cleanup}
        />,
      )
    expect(rasterize.mock.calls[0]?.[2].aborted).toBe(true)
    await act(async () => next.resolve())
    expect(screen.queryByRole('img')).toBeNull()
    expect(blobs).toEqual([])
    expect(names).toEqual([])
  },
)

const offlineLocales = [
  ['zh-CN', '导出范围', '整份作品（3 张）', '离线 ZIP', '离线 HTML', '导出'],
  ['en', 'Export scope', 'Entire artifact (3 artboards)', 'Offline ZIP', 'Offline HTML', 'Export'],
  [
    'de',
    'Exportumfang',
    'Gesamtes Werk (3 Zeichenflächen)',
    'Offline-ZIP',
    'Offline-HTML',
    'Exportieren',
  ],
  ['ar', 'نطاق التصدير', /العمل كاملًا/, 'ZIP دون اتصال', 'HTML دون اتصال', 'تصدير'],
] as const

async function nextOfflineFrame(previous?: HTMLIFrameElement) {
  return waitFor(() => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[sandbox="allow-scripts"]')
    if (!frame?.contentWindow || frame === previous) throw new Error('尚未生成下一张画板')
    return frame
  })
}

function replyFromOfflineSandbox(frame: HTMLIFrameElement, error?: string) {
  fireEvent(
    window,
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: 'null',
      data: error
        ? { type: 'akasha.offline.error', message: error }
        : { type: 'akasha.offline.ready' },
    }),
  )
}

async function readDownloadedZip(blobs: Blob[]) {
  const [file] = blobs
  if (blobs.length !== 1 || !file) throw new Error('未收到唯一的 ZIP 文件')
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const index = entries['index.html']
  if (!index) throw new Error('ZIP 缺少 index.html')
  const doc = new DOMParser().parseFromString(strFromU8(index), 'text/html')
  const json = doc.getElementById('akasha-offline-data')?.textContent
  if (!json) throw new Error('未找到离线作品数据')
  return { files: Object.keys(entries).sort(), json, data: JSON.parse(json) }
}

it.each(offlineLocales)(
  '%s：从单板切换到整份离线 ZIP，只交付复核后的固定版本',
  async (locale, scope, entire, zip, html, action) => {
    const { names, blobs } = trackDownloads()
    const request = vi.mocked(window.fetch)
    const endpoint = `/api/v1/artifacts/${artifact.publicId}?version=2`
    request.mockImplementation(async (url) => {
      if (url === endpoint)
        return Response.json({
          artifact: artboard,
          version: pinned,
          conversation: 'private-chat-sentinel',
          temporaryTweaks: 'private-tweak-sentinel',
        })
      if (url === '/assets/akasha-offline.bundle.txt')
        return new Response('H4sIAAAAAAAAAwMAAAAAAAAAAAA=')
      throw new Error(`意外请求：${url}`)
    })
    setLocale(locale)
    onTestFinished(() => setLocale('zh-CN'))
    render(
      <ArtifactExportDialog
        target={{ artifact: artboard, version: pinned, boardId: 'start' }}
        onClose={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'HTML ZIP' }))
    fireEvent.click(screen.getByRole('combobox', { name: scope }))
    fireEvent.click(screen.getByRole('option', { name: entire }))
    expect(screen.getByRole('radio', { name: 'PDF' })).toHaveProperty('checked', true)
    expect(screen.getByRole('radio', { name: html })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'HTML ZIP' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: zip }))
    expect(screen.getByText(/index\.html/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: action }))
    let frame: HTMLIFrameElement | undefined
    if (locale === 'zh-CN') {
      frame = await nextOfflineFrame()
      replyFromOfflineSandbox(frame)
      frame = await nextOfflineFrame(frame)
      replyFromOfflineSandbox(frame, 'preflight-failure')
      expect((await screen.findByRole('alert')).textContent).toContain('preflight-failure')
      expect(names).toEqual([])
      expect(blobs).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: action }))
    }
    for (let index = 0; index < 3; index++) {
      frame = await nextOfflineFrame(frame)
      replyFromOfflineSandbox(frame)
    }
    await waitFor(() => expect(names).toEqual(['受保护的设计-v2.zip']))
    expect(request.mock.calls.filter(([url]) => url === endpoint)).toHaveLength(
      locale === 'zh-CN' ? 2 : 1,
    )
    const { files, json, data } = await readDownloadedZip(blobs)
    expect(files).toEqual(['assets/player.js', 'assets/runtime.js', 'index.html'])
    expect(data).toMatchObject({ title: pinned.title, version: 2 })
    expect(data.pages).toEqual([
      { id: 'flow', title: '预订', boardIds: ['finish', 'other', 'start'] },
    ])
    expect(json).not.toMatch(/private-.*-sentinel|agent:cli|protected-design/)
  },
)

it('单板 HTML ZIP 不带其他画板；中途关闭不会下载', async () => {
  const { names, blobs } = trackDownloads()
  const request = vi.mocked(window.fetch)
  const start = () => {
    render(
      <ArtifactExportDialog
        target={{ artifact: artboard, version: pinned, boardId: 'start' }}
        onClose={cleanup}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'HTML ZIP' }))
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
  }
  request.mockImplementation(async (url) =>
    url === '/assets/akasha-offline.bundle.txt'
      ? new Response('H4sIAAAAAAAAAwMAAAAAAAAAAAA=')
      : Response.json({ artifact: artboard, version: pinned }),
  )
  start()
  const abandoned = await nextOfflineFrame()
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(abandoned.isConnected).toBe(false))
  expect(names).toEqual([])
  expect(blobs).toEqual([])
  start()
  replyFromOfflineSandbox(await nextOfflineFrame())
  await waitFor(() => expect(names).toEqual(['受保护的设计-v2-首页.zip']))
  const { files, data } = await readDownloadedZip(blobs)
  expect(files).toEqual(['index.html'])
  expect(data.boards).toEqual([
    expect.objectContaining({ id: 'start', title: '首页', source: expect.any(String) }),
  ])
})

it('整份 ZIP 在确认时遇到权限撤销或返回其他版本，均不打包', async () => {
  const { names, blobs } = trackDownloads()
  const request = vi.mocked(window.fetch)
  request
    .mockResolvedValueOnce(
      Response.json({ error: { code: 'FORBIDDEN', message: '不可读取' } }, { status: 403 }),
    )
    .mockResolvedValueOnce(
      Response.json({ artifact: artboard, version: { ...pinned, version: 4 } }),
    )
  render(
    <ArtifactExportDialog target={{ artifact: artboard, version: pinned }} onClose={() => {}} />,
  )
  fireEvent.click(screen.getByRole('radio', { name: '离线 ZIP' }))
  for (const message of ['不可读取', '未能读取指定版本']) {
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(message))
  }
  expect(document.querySelector('iframe[sandbox="allow-scripts"]')).toBeNull()
  expect(blobs).toEqual([])
  expect(names).toEqual([])
  expect(request).toHaveBeenCalledTimes(2)
})
