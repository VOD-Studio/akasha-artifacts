// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CodingWorkspacePage } from '../src/features/artifact-delivery'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('从绑定会话恢复固定选区，在 Web 修改原型后打开真实的新版本', async () => {
  const id = '52948d56-7df6-4bf5-a3cb-296ffa18fc26'
  const artifactId = 'CheckoutDesign000001'
  const reference = {
    artifactId,
    projectId: 'team',
    version: 3,
    pageId: '',
    boardId: 'main',
    element: { selector: '#submit' },
  }
  const source = '<button id="submit">保存</button>'
  const edited = source.replace('保存', '提交订单')
  const root = `/api/v1/projects/team/coding-sessions/${id}`
  const receipt = { artifactId, version: 4, path: `/a/${artifactId}/v/4` }
  let published = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(init?.method).toBe('POST')
    if (String(url) === `${root}/workspace`)
      return Response.json({
        target: { id, label: '订单工程', bound: true },
        snapshot: {
          reference,
          design: {
            ...reference,
            slug: 'checkout',
            title: '结账',
            type: 'html',
            source,
            structure: { pages: [], boards: [], flows: [] },
            selection: { pageId: '', boardId: 'main', element: reference.element },
            note: '素材',
          },
          components: [],
          reviewedSystem: null,
        },
        publication: published ? receipt : null,
      })
    expect(String(url)).toBe(`${root}/workspace-publish`)
    expect(JSON.parse(String(init?.body))).toEqual({ source: edited })
    published = true
    return Response.json(receipt, { status: 201 })
  })
  const open = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CodingWorkspacePage projectId="team" sessionId={id} />
      </QueryClientProvider>,
    )
  const page = open()
  const editor = await screen.findByRole('textbox', { name: '作品源码' })
  expect((editor as HTMLTextAreaElement).value).toBe(source)
  expect(screen.getByText(/#submit/)).toBeDefined()
  fireEvent.change(editor, { target: { value: edited } })
  fireEvent.click(screen.getByRole('button', { name: '发布新版本' }))
  expect((await screen.findByRole('link', { name: '打开 v4' })).getAttribute('href')).toBe(
    receipt.path,
  )
  page.unmount()
  open()
  await screen.findByRole('link', { name: '打开 v4' })
  expect((screen.getByRole('textbox', { name: '作品源码' }) as HTMLTextAreaElement).value).toBe(
    source,
  )
})
