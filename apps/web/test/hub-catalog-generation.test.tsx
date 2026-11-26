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
const baseline = 'export default function Brand() {\n  return <p>Brand</p>\n}'
const reference = { id: first, version: 2, sourceVersion: 'a'.repeat(64), components: [component] }

function openLibrary(candidate = false, multipleProjects = false) {
  stubResizeObserver()
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const projects = [{ id: 'alpha', name: 'Alpha' }]
  if (multipleProjects) projects.push({ id: 'beta', name: 'Beta' })
  cache.setQueryData(projectKeys.all, projects)
  cache.setQueryData(artifactKeys.list(undefined), [])
  const open = vi.fn()
  const requests: Record<string, unknown>[] = []
  let inheritDefault = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/session'))
      return Response.json({ user: { member: true, admin: false, login: 'ada' } })
    if (url.endsWith('/beta/system-catalog')) return Response.json({ inheritDefault, items: [] })
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
    if (url.endsWith('/alpha/system-catalog/preview') && init?.method === 'POST')
      return Response.json({ source: baseline, references: [reference] })
    if (url.endsWith('/alpha/system-catalog/generate') && init?.method === 'POST') {
      requests.push(JSON.parse(String(init.body)))
      if (candidate && requests.length === 1)
        return Response.json(
          {
            error: {
              code: 'BAD_REQUEST',
              message: 'manual review',
              details: {
                kind: 'manual-review',
                reason: 'instance',
                line: 2,
                references: [reference],
                actions: ['edit-source', 'regenerate'],
              },
            },
          },
          { status: 400 },
        )
      if (!candidate && requests.length === 1) return new Response(null, { status: 403 })
      const { artifact, version } = detailFor()
      return Response.json(
        {
          artifact: { ...artifact, publicId: generated, projectId: 'alpha', type: 'react' },
          version: { ...version, artifactId: generated },
          references: [],
          corrections:
            candidate && requests.at(-1)?.candidateSource
              ? [
                  { kind: 'component', id: first, version: 2, component },
                  { kind: 'guidance', id: first, version: 2 },
                ]
              : [],
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

it.each(['修订', '重新生成'])(
  '候选稿在真实库页定位偏差并%s，保留用户原稿至明确提交',
  async (action) => {
    const { open, requests } = openLibrary(true)
    fireEvent.click(await screen.findByRole('button', { name: '新建设计' }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.change(dialog.getByRole('textbox', { name: '设计名称' }), {
      target: { value: 'Review' },
    })
    const load = await dialog.findByRole<HTMLButtonElement>('button', { name: '载入所选版本基准' })
    await waitFor(() => expect(load.disabled).toBe(false))
    fireEvent.click(load)
    const source = await dialog.findByDisplayValue<HTMLTextAreaElement>(baseline, {
      normalizer: (value) => value,
    })
    expect(requests).toEqual([])
    const edited = baseline.replace('Brand</p>', 'Checkout</p>')
    fireEvent.change(source, { target: { value: edited } })
    fireEvent.click(dialog.getByRole('button', { name: '创建' }))
    fireEvent.click(await dialog.findByRole('button', { name: '定位并编辑' }))
    expect(document.activeElement).toBe(source)
    expect(source.selectionStart).toBe(edited.indexOf('\n') + 1)
    expect(source.value).toBe(edited)
    if (action === '重新生成') {
      fireEvent.click(dialog.getByRole('button', { name: '按固定版本重新生成' }))
      await waitFor(() => expect(open).toHaveBeenCalledWith(generated, 'hub'))
      expect(requests[1]).not.toHaveProperty('candidateSource')
      expect(requests[1].selections).toEqual([{ id: first, version: 2 }])
      return
    }
    const fixed = edited.replace('Checkout', 'Checkout now')
    fireEvent.change(source, { target: { value: fixed } })
    fireEvent.click(dialog.getByRole('button', { name: '创建' }))
    const openSaved = await dialog.findByRole('button', { name: '打开修正版' })
    expect(requests.map((request) => request.candidateSource)).toEqual([edited, fixed])
    expect(dialog.getByText('ui/Brand.tsx#Brand')).toBeDefined()
    expect(dialog.getByText('已恢复规范')).toBeDefined()
    expect(dialog.queryByRole('button', { name: '创建' })).toBeNull()
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(openSaved)
    expect(open).toHaveBeenCalledWith(generated, 'hub')
  },
)

it('导入候选文件须确认替换现有编辑；切换项目不带走原项目候选源码', async () => {
  const { requests } = openLibrary(false, true)
  fireEvent.click(await screen.findByRole('button', { name: '新建设计' }))
  const dialog = within(await screen.findByRole('dialog'))
  const selectProject = async (name: string) => {
    fireEvent.click(dialog.getByRole('combobox', { name: '项目' }))
    fireEvent.click(await screen.findByRole('option', { name }))
  }
  await selectProject('Alpha')
  const editor = dialog.getByRole<HTMLTextAreaElement>('textbox', { name: '候选稿源码' })
  fireEvent.change(editor, { target: { value: 'My draft' } })
  fireEvent.change(dialog.getByLabelText('导入候选稿'), {
    target: { files: [new File(['Private candidate'], 'private.tsx')] },
  })
  const replace = await dialog.findByRole('button', { name: '替换当前候选稿' })
  expect(editor.value).toBe('My draft')
  fireEvent.click(replace)
  expect(editor.value).toBe('Private candidate')
  await selectProject('Beta')
  fireEvent.click(dialog.getByRole('button', { name: '保留当前候选稿' }))
  expect(editor.value).toBe('Private candidate')
  await selectProject('Beta')
  fireEvent.click(dialog.getByRole('button', { name: '放弃候选稿并切换项目' }))
  expect(dialog.getByRole<HTMLTextAreaElement>('textbox', { name: '候选稿源码' }).value).toBe('')
  expect(requests).toEqual([])
})
