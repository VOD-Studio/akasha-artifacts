// @vitest-environment jsdom
import { gzipSync, strFromU8, strToU8, unzipSync } from 'fflate'
import { expect, it, onTestFinished, vi } from 'vitest'
import { composeOfflineDesign } from '../src/features/export-design'
import { setLocale } from '../src/shared/i18n'

function acceptPreflight() {
  const runtime = Buffer.from(
    gzipSync(strToU8(JSON.stringify({ script: '', style: '' }))),
  ).toString('base64')
  vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(runtime))
  // jsdom 不执行 iframe.srcdoc；本测试用沙盒的完成回执放行，验证实际交付的 ZIP 字节。
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      for (const node of change.addedNodes) {
        if (!(node instanceof HTMLIFrameElement) || !node.contentWindow) continue
        window.dispatchEvent(
          new MessageEvent('message', {
            origin: 'null',
            source: node.contentWindow,
            data: { type: 'akasha.offline.ready' },
          }),
        )
      }
    }
  })
  observer.observe(document.body, { childList: true })
  onTestFinished(() => {
    observer.disconnect()
    vi.restoreAllMocks()
    setLocale('zh-CN')
  })
}

function readBytes(blob: Blob): Promise<Uint8Array> {
  const reader = new FileReader()
  return new Promise((resolve, reject) => {
    reader.onload = () => {
      if (reader.result === null || typeof reader.result === 'string')
        reject(new Error('无法读取 ZIP'))
      else resolve(new Uint8Array(reader.result))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

it('整份 ZIP 的本地入口保留各固定版本、共享画板和流程，不携带工作区私有数据', async () => {
  acceptPreflight()
  const start = {
    id: 'shared',
    title: '起点',
    width: 320,
    height: 240,
    type: 'html' as const,
    scoped: true,
    source: '<button data-ak-next="end">继续</button>',
    session: 'PRIVATE-SESSION-NOT-FOR-EXPORT',
  }
  for (const [version, locale, content] of [
    [2, 'zh-CN', '第二版收据'],
    [7, 'en', 'Receipt version seven'],
  ] as const) {
    setLocale(locale)
    const design = {
      title: '订购',
      version,
      pages: [
        { id: 'order', title: '订单', boardIds: ['shared'] },
        { id: 'result', title: '完成', boardIds: ['end', 'shared'] },
        { id: 'blank', title: '空页', boardIds: [] },
      ],
      boards: [start, { ...start, id: 'end', title: '收据', source: `<p>${content}</p>` }],
      flows: [{ from: 'shared', to: 'end', label: '打开收据' }],
      feedback: 'PRIVATE-NOTE-NOT-FOR-EXPORT',
    }
    const file = await composeOfflineDesign(
      design,
      'design-zip',
      new AbortController().signal,
      () => {},
    )
    const entries = unzipSync(await readBytes(file))
    const html = strFromU8(entries['index.html'])
    const entry = new DOMParser().parseFromString(html, 'text/html')
    expect(entry.documentElement.lang).toBe(locale)
    const scripts = [...entry.querySelectorAll('script[src]')].map((script) =>
      script.getAttribute('src'),
    )
    expect(scripts.length).toBeGreaterThan(0)
    for (const path of scripts) {
      expect(path).toMatch(/^assets\/[\w.-]+\.js$/)
      expect(entries[path ?? '']?.byteLength).toBeGreaterThan(0)
    }
    const payload = JSON.parse(entry.getElementById('akasha-offline-data')?.textContent ?? '')
    expect(payload.version).toBe(version)
    expect(payload.pages).toEqual(design.pages)
    expect(payload.boards.map((board: { source: string }) => board.source)).toEqual([
      start.source,
      `<p>${content}</p>`,
    ])
    expect(payload.flows).toEqual(design.flows)
    expect(html).not.toContain('PRIVATE-')
  }
})

it('即使是后续画板内隐藏的外部资源，也在请求运行器前阻止下载并指出具体画板', async () => {
  const board = {
    id: 'first',
    width: 360,
    height: 640,
    title: '起始',
    type: 'html' as const,
    scoped: true,
  }
  await expect(
    composeOfflineDesign(
      {
        title: '预订流程',
        version: 1,
        pages: [{ id: 'flow', title: '预订', boardIds: ['first', 'second'] }],
        flows: [{ from: 'first', to: 'second' }],
        boards: [
          { ...board, source: '<p>自包含首页</p>' },
          {
            ...board,
            id: 'second',
            title: '完成',
            source: '<style>@media (width > 1000px) {button {background:url(/bg.png)}}</style>',
          },
        ],
      },
      'design-html',
      new AbortController().signal,
      () => undefined,
    ),
  ).rejects.toThrow('「完成」：不能离线打包样式资源：/bg.png')
})

it('不把普通 src 变量当成 URL，只报告真实 JSX 资源属性', async () => {
  const board = {
    id: 'first',
    width: 360,
    height: 640,
    title: '正文',
    type: 'react' as const,
    scoped: false,
  }
  await expect(
    composeOfflineDesign(
      {
        title: '预订流程',
        version: 1,
        pages: [{ id: '', title: '总览', boardIds: ['first', 'second'] }],
        flows: [],
        boards: [
          {
            ...board,
            source: "export default function App() { const src = '正文'; return <p>{src}</p> }",
          },
          {
            ...board,
            id: 'second',
            title: '照片',
            source: "export default () => <img src={'/photo.png'} />",
          },
        ],
      },
      'design-html',
      new AbortController().signal,
      () => undefined,
    ),
  ).rejects.toThrow('「照片」：不能离线打包资源：/photo.png')
})
