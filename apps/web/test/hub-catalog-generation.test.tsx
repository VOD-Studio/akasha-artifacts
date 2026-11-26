// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact'
import { projectKeys } from '../src/entities/project'
import { LibraryShell } from '../src/widgets/LibraryShell'
import { detailFor, stubResizeObserver } from './canvas-test-fixture'

const first = 'CanvasExamplePublicId1'
const second = 'CanvasExamplePublicId2'
const generated = 'GeneratedCatalogDesign1'
const component = { path: 'ui/Brand.tsx', exportName: 'Brand' }
function openLibrary() {
  stubResizeObserver()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  cache.setQueryData(projectKeys.all, [{ id: 'alpha', name: 'Alpha' }])
  cache.setQueryData(artifactKeys.list(undefined), [])
  const open = vi.fn()
  const requests: Record<string, unknown>[] = []
  let inheritDefault = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/session'))
      return Response.json({ user: { member: true, admin: false, login: 'ada' } })
    if (url.endsWith('/alpha/system-catalog'))
      return Response.json({
        inheritDefault,
        items: [first, second].map((id) => ({
          id,
          version: 2,
          title: 'Brand',
          components: [component],
          guidance: { fontFamily: 'serif', color: '#333', spacing: 12, instructions: '' },
          publication: 'team',
          isDefault: id === first,
        })),
      })
    if (url.endsWith('/alpha/system-catalog/preference') && init?.method === 'PUT') {
      inheritDefault = JSON.parse(String(init.body)).inheritDefault
      return Response.json({ ok: true })
    }
    if (url.endsWith('/alpha/system-catalog/generate') && init?.method === 'POST') {
      requests.push(JSON.parse(String(init.body)))
      if (requests.length === 1) return new Response(null, { status: 403 })
      const { artifact, version } = detailFor()
      return Response.json(
        {
          artifact: { ...artifact, publicId: generated, projectId: 'alpha', type: 'react' },
          version: { ...version, artifactId: generated },
          references: [],
        },
        { status: 201 },
      )
    }
    return new Response(null, { status: 404 })
  })
  render(
    <QueryClientProvider client={cache}>
      <LibraryShell onOpenArtifact={open} />
    </QueryClientProvider>,
  )
  return { open, requests }
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['使用个人设置', '本次不使用系统', '选择系统版本'])(
  '成员在真实库页按「%s」创建，拒绝后保留选择，成功后打开 Hub 作品',
  async (mode) => {
    const { open, requests } = openLibrary()
    fireEvent.click(await screen.findByRole('button', { name: '新建设计' }))
    const form = within(await screen.findByRole('dialog'))
    fireEvent.change(form.getByRole('textbox', { name: '设计名称' }), {
      target: { value: 'Checkout' },
    })
    const modes = await form.findByRole('combobox', { name: '本次设计系统' })
    if (mode !== '使用个人设置') {
      fireEvent.click(modes)
      fireEvent.click(await screen.findByRole('option', { name: mode }))
    }
    if (mode === '选择系统版本') {
      fireEvent.click(form.getByRole('checkbox', { name: new RegExp(first) }))
      fireEvent.click(form.getByRole('checkbox', { name: new RegExp(second) }))
      fireEvent.click(form.getByRole('combobox', { name: new RegExp(first) }))
      fireEvent.click(await screen.findByRole('option', { name: 'ui/Brand.tsx#Brand' }))
    }
    const submit = form.getByRole('button', { name: '创建' })
    fireEvent.click(submit)
    await form.findByRole('alert')
    expect(open).not.toHaveBeenCalled()
    expect(form.getByDisplayValue('Checkout')).toBeDefined()
    fireEvent.click(submit)
    await waitFor(() => expect(open).toHaveBeenCalledWith(generated, 'hub'))
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0]).toMatchObject({ title: 'Checkout', slug: expect.any(String) })
    if (mode === '使用个人设置') expect(requests[0]).not.toHaveProperty('selections')
    if (mode === '本次不使用系统') expect(requests[0].selections).toEqual([])
    if (mode === '选择系统版本')
      expect(requests[0].selections).toEqual([
        { id: first, version: 2, component },
        { id: second, version: 2 },
      ])
  },
)

it('成员改变继承偏好后关闭重开目录，仍显示已保存的选择', async () => {
  openLibrary()
  fireEvent.click(await screen.findByRole('button', { name: '系统目录' }))
  const toggle = await screen.findByRole('checkbox', { name: '继承团队默认' })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(toggle)
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'))
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '系统目录' }))
  expect(
    (await screen.findByRole('checkbox', { name: '继承团队默认' })).getAttribute('aria-checked'),
  ).toBe('false')
})
