// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  artifact,
  design,
  detailFor,
  setupCanvasTest,
  showWorkspace,
  workspace,
} from './canvas-test-fixture'

setupCanvasTest()

it('Hub 编辑在原基准上提交；发生冲突后可取回草稿并按新头重新选择，不强制覆盖', async () => {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true, apiBaseUrl: 'https://elsewhere.example.test' })
  const path = `/api/v1/artifacts/${artifact.publicId}/canvas-edits`
  const drafts: Array<{ baseVersion: number; source: string }> = []
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (url !== path) return Response.json({})
    drafts.push(JSON.parse(String(init?.body)))
    return Response.json(
      {
        error: {
          code: 'VERSION_CONFLICT',
          message: '此处已有其他改动。请保留草稿，在最新画布上重新选择。',
        },
      },
      { status: 409 },
    )
  })
  const view = showWorkspace()
  const v1 = { ...detailFor(), hubCanEditCanvas: true }
  view.update(workspace(v1))
  fireEvent.click(screen.getByRole('button', { name: '设置画板：宽屏首页' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: '宽度' }), { target: { value: '880' } })
  const v2 = {
    ...detailFor(
      2,
      JSON.stringify({
        ...design,
        boards: design.boards.map((b) =>
          b.id === 'desktop' ? { ...b, viewport: { width: 1000, height: 900 } } : b,
        ),
      }),
    ),
    hubCanEditCanvas: true,
  }
  view.update(workspace(v2))
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  const alert = await screen.findByRole('alert')
  expect(drafts).toHaveLength(1)
  const [draft] = drafts
  if (!draft) throw new Error('服务端未收到候选画稿')
  expect(draft.baseVersion).toBe(1)
  expect(JSON.parse(draft.source).boards[0].viewport.width).toBe(880)
  expect(request).toHaveBeenCalledWith(
    path,
    expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
  )
  expect(
    within(alert).getByText('此处已有其他改动。请保留草稿，在最新画布上重新选择。'),
  ).toBeTruthy()
  expect(within(alert).getByRole('button', { name: '下载草稿' })).toBeTruthy()
  fireEvent.click(within(alert).getByRole('button', { name: '放弃改动' }))
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '设置画板：宽屏首页' }))
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: '宽度' }).value).toBe('1000')
  fireEvent.change(screen.getByRole('spinbutton', { name: '宽度' }), { target: { value: '920' } })
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await waitFor(() => expect(drafts.map((draft) => draft.baseVersion)).toEqual([1, 2]))
})

it('作品可见不等于可共编；Hub 未明确授予编辑或收回权限后不再显示画板编辑工具', () => {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub: true })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}))
  const view = showWorkspace()
  const settings = () => screen.queryByRole('button', { name: '设置画板：宽屏首页' })
  expect(settings()).toBeNull()
  const editable = { ...detailFor(), hubCanEditCanvas: true }
  view.update(workspace(editable))
  expect(settings()).not.toBeNull()
  const reader = { ...detailFor(), hubCanEditCanvas: false }
  view.update(workspace(reader))
  expect(settings()).toBeNull()
  expect(screen.getByTitle('画板内容：宽屏首页')).toBeTruthy()
})
