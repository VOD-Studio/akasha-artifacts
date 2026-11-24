import type { ArtboardContent } from '@akasha/protocol'
import { expect, it, vi } from 'vitest'
import { BoardResources } from '../src/widgets/ArtifactWorkspace/board-resources'

function fixture() {
  const requests: Array<{
    id: string
    signal: AbortSignal
    fulfill: (text?: string) => void
    fail: (error: Error) => void
  }> = []
  const resources = new BoardResources((id, signal) => {
    const { promise, resolve, reject } = Promise.withResolvers<ArtboardContent>()
    requests.push({ id, signal, fulfill: (html = id) => resolve({ id, html }), fail: reject })
    return promise
  })
  return { resources, requests }
}

it('平移释放旧请求的名额，同一块板的迟到响应不能覆盖重新进入后的正文', async () => {
  const { resources, requests } = fixture()
  resources.setDemand(['a', 'b', 'c', 'd', 'queued'], false)
  expect(requests.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd'])
  resources.setDemand(['next', 'b'], false)
  expect(requests.map(({ id }) => id)).toEqual(['a', 'b', 'c', 'd', 'next'])
  expect(requests.slice(0, 4).map(({ signal }) => signal.aborted)).toEqual([
    true,
    false,
    true,
    true,
  ])
  resources.setDemand(['a', 'next'], false)
  requests[5]?.fulfill('当前请求')
  requests[0]?.fulfill('已经取消')
  await Promise.resolve()
  expect(resources.get('a')).toMatchObject({ data: { html: '当前请求' } })
  resources.reset()
})

it('只重试失败的板，回到已读区域时复用正文，退出版本时清空', async () => {
  const { resources, requests } = fixture()
  resources.setDemand(['a', 'b'], false)
  requests[0]?.fail(new Error('暂时失败'))
  requests[1]?.fulfill()
  await Promise.resolve()
  expect(resources.get('a')).toMatchObject({ type: 'error', message: '暂时失败' })
  resources.setDemand([], false)
  resources.setDemand(['b', 'a'], false)
  resources.retry('a')
  expect(requests.map(({ id }) => id)).toEqual(['a', 'b', 'a'])
  expect(resources.get('b')).toMatchObject({ data: { html: 'b' } })
  resources.reset()
  requests[2]?.fulfill('不在当前版本')
  await Promise.resolve()
  expect(requests[2]?.signal.aborted).toBe(true)
  expect(resources.get('a')).toBeUndefined()
  expect(resources.get('b')).toBeUndefined()
})

it('视口与检查器去重并共享四个读取名额，视口排队和新进入的画板优先', async () => {
  const { resources, requests } = fixture()
  const requested = () => requests.map(({ id }) => id)
  resources.setDemand(['a', 'b', 'c', 'd', 'e'], false)
  resources.setInspectorBoard('a')
  expect(requested()).toEqual(['a', 'b', 'c', 'd'])
  expect(requests[0]?.signal.aborted).toBe(false)

  resources.setInspectorBoard('source')
  requests[0]?.fulfill()
  await Promise.resolve()
  expect(requested()).toEqual(['a', 'b', 'c', 'd', 'e'])
  requests[1]?.fulfill()
  await Promise.resolve()
  expect(requested()).toEqual(['a', 'b', 'c', 'd', 'e', 'source'])

  resources.setDemand(['new', 'c', 'd', 'e'], false)
  expect(requested()).toEqual(['a', 'b', 'c', 'd', 'e', 'source', 'new'])
  expect(requests[5]?.signal.aborted).toBe(true)
  requests[6]?.fulfill()
  await Promise.resolve()
  expect(requested()).toEqual(['a', 'b', 'c', 'd', 'e', 'source', 'new', 'source'])

  resources.setDemand(['source', 'c', 'd', 'e'], false)
  resources.setInspectorBoard(undefined)
  expect(requests).toHaveLength(8)
  expect(requests[7]?.signal.aborted).toBe(false)
  resources.setDemand(['c', 'd', 'e'], false)
  expect(requests[7]?.signal.aborted).toBe(true)
  resources.reset()
})

it('交互恢复或画板移出时取消截图，检查器的只读需求不参与截图', async () => {
  vi.useFakeTimers()
  const { resources, requests } = fixture()
  try {
    resources.setDemand(['visible'], true)
    resources.setInspectorBoard('source')
    requests[0]?.fulfill()
    await Promise.resolve()

    const pending = Promise.withResolvers<Blob>()
    const retried = Promise.withResolvers<Blob>()
    const capture = vi.fn((_signal: AbortSignal) => retried.promise).mockReturnValueOnce(pending.promise)
    const sourceCapture = vi.fn(() => Promise.resolve(new Blob()))
    resources.previewReady('visible', capture)
    resources.previewReady('source', sourceCapture)
    await vi.advanceTimersByTimeAsync(600)
    expect(capture).toHaveBeenCalledTimes(1)
    expect(sourceCapture).not.toHaveBeenCalled()

    resources.setDemand(['visible'], false)
    expect(capture.mock.calls[0]?.[0].aborted).toBe(true)
    resources.setDemand(['visible'], true)
    await vi.advanceTimersByTimeAsync(600)
    expect(capture).toHaveBeenCalledTimes(1)

    pending.resolve(new Blob(['已取消的截图']))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(600)
    expect(capture).toHaveBeenCalledTimes(2)
    expect(resources.thumbnail('visible')).toBeUndefined()

    resources.setInspectorBoard('visible')
    resources.setDemand([], true)
    expect(capture.mock.calls[1]?.[0].aborted).toBe(true)
    retried.resolve(new Blob(['已经移出的截图']))
    await Promise.resolve()
    expect(resources.thumbnail('visible')).toBeUndefined()
    expect(sourceCapture).not.toHaveBeenCalled()
  } finally {
    resources.reset()
    vi.useRealTimers()
  }
})
