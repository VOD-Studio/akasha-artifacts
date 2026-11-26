// @vitest-environment jsdom
import type { AgentReferenceScope } from '@akasha/protocol'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReferenceDraft } from '../src/features/agent-conversation/references/useReferenceDraft'

const sessionA = '3301aee2-0a60-4b92-93b2-26e46db449ce'
const sessionB = 'ccc1576c-f8fd-4be2-9abb-c2dcfa549b30'

function captureRequests() {
  const requests: {
    method?: string
    body: { scope: AgentReferenceScope; file?: { name: string; content: string }; id?: string }
    respond: (response: Response) => void
  }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    expect(String(url)).toBe('/api/v1/agent/references')
    const { promise, resolve } = Promise.withResolvers<Response>()
    requests.push({ method: init?.method, body: JSON.parse(String(init?.body)), respond: resolve })
    return promise
  })
  return requests
}

function preview(id: string, expiresAt = Date.now() + 60_000) {
  return Response.json({
    id,
    expiresAt,
    name: 'brief.txt',
    kind: 'design',
    bytes: 3,
    sha256: 'd'.repeat(64),
    text: 'abc',
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('只预览所选文件的原始字节；到期后保留文件，重新预览才能发送', async () => {
  const requests = captureRequests()
  const { result } = renderHook(() => useReferenceDraft('studio'))
  const file = new File(['abc'], 'brief.txt')
  act(() => result.current.add([file]))
  expect(result.current.blocked).toBe(true)
  await waitFor(() => expect(requests).toHaveLength(1))
  const first = requests[0]
  expect(first.method).toBe('POST')
  expect(first.body.file).toEqual({ name: 'brief.txt', content: 'YWJj' })
  const oldId = crypto.randomUUID()
  vi.useFakeTimers()
  await act(async () => first.respond(preview(oldId, Date.now() + 1_000)))
  expect(result.current.selection).toEqual({ draftId: first.body.scope.draftId, ids: [oldId] })
  vi.setSystemTime(Date.now() + 1_000)
  expect(result.current.blocked).toBe(true)
  expect(result.current.selection).toBeUndefined()
  act(() => {
    vi.advanceTimersByTime(1_000)
  })
  expect(result.current.entries[0]).toMatchObject({ file, status: 'expired' })
  expect(result.current.blocked).toBe(true)
  expect(result.current.selection).toBeUndefined()
  vi.useRealTimers()
  act(() => result.current.retry(result.current.entries[0].key))
  await waitFor(() => expect(requests).toHaveLength(2))
  const newId = crypto.randomUUID()
  await act(async () => requests[1].respond(preview(newId)))
  expect(result.current.selection?.ids).toEqual([newId])
})

it.each([
  ['切换项目', 'other', sessionA],
  ['切换会话', 'studio', sessionB],
  ['撤回授权', '', sessionA],
])('%s 时立即隔离材料，迟到的预览只撤回原作用域的标识', async (_, projectId, sessionId) => {
  const requests = captureRequests()
  const original = { projectId: 'studio', sessionId: sessionA }
  const { result, rerender } = renderHook(
    (props: typeof original) => useReferenceDraft(props.projectId, props.sessionId),
    { initialProps: original },
  )
  const file = new File(['abc'], 'brief.txt')
  act(() => result.current.add([file]))
  await waitFor(() => expect(requests).toHaveLength(1))
  const first = requests[0]
  expect(first.body.scope).toMatchObject(original)
  const oldDraft = result.current
  rerender({ projectId, sessionId })
  expect(result.current.entries).toEqual([])
  expect(result.current.selection).toBeUndefined()
  act(() => oldDraft.add([file]))
  if (!projectId) act(() => result.current.add([file]))
  rerender(original)
  const id = crypto.randomUUID()
  await act(async () => first.respond(preview(id)))
  expect(requests.map(({ method }) => method)).toEqual(['POST', 'DELETE'])
  expect(requests[1].body).toEqual({ scope: first.body.scope, id })
  expect(result.current.entries).toEqual([])
  expect(result.current.selection).toBeUndefined()
})

it('失去本机授权即隐藏已预览的内容，恢复同一项目不会复活旧清单', async () => {
  const requests = captureRequests()
  const { result, rerender } = renderHook((id: string) => useReferenceDraft(id), {
    initialProps: 'studio',
  })
  const file = new File(['abc'], 'brief.txt')
  act(() => result.current.add([file]))
  await waitFor(() => expect(requests).toHaveLength(1))
  const id = crypto.randomUUID()
  await act(async () => requests[0].respond(preview(id)))
  const previous = result.current
  expect(previous.entries[0].preview?.text).toBe('abc')
  expect(previous.selection?.ids).toEqual([id])
  rerender('')
  expect(result.current.entries).toEqual([])
  expect(previous.selection).toBeUndefined()
  expect(requests[1].body).toEqual({ scope: requests[0].body.scope, id })
  act(() => result.current.add([file]))
  expect(result.current.entries).toEqual([])
  rerender('studio')
  expect(result.current.entries).toEqual([])
  expect(result.current.selection).toBeUndefined()
})

it('移除尚未返回的预览：撤回失败保留文件，重试只撤回，不将它混入发送清单', async () => {
  const requests = captureRequests()
  const { result } = renderHook(() => useReferenceDraft('studio'))
  const removed = new File(['aaa'], 'remove.txt')
  const kept = new File(['bbb'], 'keep.txt')
  act(() => result.current.add([removed, kept]))
  await waitFor(() => expect(requests).toHaveLength(2))
  const first = requests.find(({ body }) => body.file?.name === removed.name)
  const second = requests.find(({ body }) => body.file?.name === kept.name)
  if (!first || !second) throw new Error('缺少材料预览请求')
  const key = result.current.entries[0].key
  const keptId = crypto.randomUUID()
  await act(async () => second.respond(preview(keptId)))
  act(() => result.current.remove(key))
  const removedId = crypto.randomUUID()
  await act(async () => first.respond(preview(removedId)))
  expect(result.current.busy).toBe(true)
  expect(result.current.selection).toBeUndefined()
  expect(requests[2].body).toEqual({ scope: first.body.scope, id: removedId })
  await act(async () => requests[2].respond(new Response(null, { status: 503 })))
  expect(result.current.entries[0]).toMatchObject({ key, file: removed, status: 'failed' })
  expect(result.current.blocked).toBe(true)
  expect(result.current.selection).toBeUndefined()
  act(() => result.current.retry(key))
  expect(requests[3].method).toBe('DELETE')
  expect(requests[3].body).toEqual(requests[2].body)
  await act(async () => requests[3].respond(new Response(null, { status: 204 })))
  expect(result.current.entries.map(({ file }) => file)).toEqual([kept])
  expect(result.current.selection?.ids).toEqual([keptId])
})

it('预览失败后能重读文件；轮次失效后旧清单立即不可发送，仅接受新预览', async () => {
  const requests = captureRequests()
  const { result } = renderHook(() => useReferenceDraft('studio'))
  const file = new File(['abc'], 'brief.txt')
  act(() => result.current.add([file]))
  await waitFor(() => expect(requests).toHaveLength(1))
  await act(async () => requests[0].respond(new Response(null, { status: 400 })))
  const { key } = result.current.entries[0]
  expect(result.current.entries[0]).toMatchObject({ file, status: 'failed' })
  expect(result.current.busy).toBe(false)
  expect(result.current.blocked).toBe(true)
  act(() => result.current.retry(key))
  await waitFor(() => expect(requests).toHaveLength(2))
  const consumed = crypto.randomUUID()
  await act(async () => requests[1].respond(preview(consumed)))
  const accepted = result.current
  expect(accepted.selection?.ids).toEqual([consumed])
  act(() => accepted.invalidate())
  expect(accepted.selection).toBeUndefined()
  expect(result.current.entries[0]).toMatchObject({ file, status: 'expired' })
  expect(result.current.blocked).toBe(true)
  expect(requests[2].body.id).toBe(consumed)
  await act(async () => requests[2].respond(new Response(null, { status: 409 })))
  act(() => result.current.retry(key))
  await waitFor(() => expect(requests).toHaveLength(4))
  expect(requests[3].body.scope.draftId).not.toBe(requests[1].body.scope.draftId)
  const fresh = crypto.randomUUID()
  await act(async () => requests[3].respond(preview(fresh)))
  expect(result.current.selection?.ids).toEqual([fresh])
  act(() => result.current.reset())
  expect(result.current.entries).toEqual([])
  expect(result.current.selection).toBeUndefined()
})

it('空文件、单件和合计超限都保留失败项，未获准的字节不上传', async () => {
  const requests = captureRequests()
  const { result } = renderHook(() => useReferenceDraft('studio'))
  const bytes = new Uint8Array(2 * 1024 * 1024)
  const valid = Array.from({ length: 4 }, (_, index) => new File([bytes], `${index}.txt`))
  const failures = [
    new File([], 'empty.txt'),
    new File([bytes, 'x'], 'large.txt'),
    new File(['x'], 'overflow.txt'),
  ]
  act(() => {
    result.current.add(valid)
    result.current.add(failures)
  })
  const rejected = result.current.entries.filter(({ status }) => status === 'failed')
  expect(rejected.map(({ file }) => file)).toEqual(failures)
  await waitFor(() => expect(requests).toHaveLength(4))
  expect(requests.map(({ body }) => body.file?.name).sort()).toEqual(valid.map((file) => file.name))
  expect(result.current.selection).toBeUndefined()
})

it('并发选择保留六个名额；回包乱序不打乱最终交付顺序', async () => {
  const requests = captureRequests()
  const { result } = renderHook(() => useReferenceDraft('studio'))
  const files = Array.from({ length: 7 }, (_, index) => new File(['x'], `${index}.txt`))
  act(() => {
    result.current.add(files.slice(0, 3))
    result.current.add(files.slice(3))
  })
  expect(result.current.entries[6]).toMatchObject({ file: files[6], status: 'failed' })
  await waitFor(() => expect(requests).toHaveLength(6))
  const ids = files.map(() => crypto.randomUUID())
  for (const request of requests.slice().reverse()) {
    const index = files.findIndex((file) => file.name === request.body.file?.name)
    await act(async () => request.respond(preview(ids[index])))
  }
  expect(result.current.selection).toBeUndefined()
  act(() => result.current.remove(result.current.entries[6].key))
  expect(result.current.selection?.ids).toEqual(ids.slice(0, 6))
})
