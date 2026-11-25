// @vitest-environment jsdom
import {
  type Artifact,
  PROTOCOL_VERSION,
  ShellToSandboxMessageSchema,
  type Version,
} from '@akasha/protocol'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PDFDocument } from 'pdf-lib'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import * as capture from '../src/shared/bridge/capture-png'
import { ArtifactExportDialog } from '../src/widgets/ArtifactWorkspace'

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

it('选区 PDF 只下载完整的定版选板，分页与画布位置一致', async () => {
  const { names, blobs } = trackDownloads()
  const png = pngFixture(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx1UAAAAASUVORK5CYII=',
  )
  const rasterize = vi
    .spyOn(capture, 'captureBoardPng')
    .mockResolvedValueOnce(png)
    .mockRejectedValueOnce(new Error('图片未加载'))
    .mockResolvedValue(png)
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
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  expect((await screen.findByRole('alert')).textContent).toContain('图片未加载')
  expect(names).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  await waitFor(() => expect(names).toEqual(['受保护的设计-v2-选区.pdf']))
  expect(rasterize.mock.calls.map(([board]) => board.id)).toEqual([
    'finish',
    'start',
    'finish',
    'start',
  ])
  const file = blobs[0]
  if (!file) throw new Error('没有收到 PDF 下载')
  const pdf = await PDFDocument.load(await file.arrayBuffer())
  expect(pdf.getPages().map((page) => page.getSize())).toEqual([
    { width: 300, height: 210 },
    { width: 540, height: 390 },
  ])
})
