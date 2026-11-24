import type { ArtboardContent } from '@akasha/protocol'
import { expect, it } from 'vitest'
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
