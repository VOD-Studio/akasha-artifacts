// @vitest-environment jsdom
import type { DesignSystemPreviewInput, Project } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryShell } from '../src/widgets/LibraryShell'

const project: Project = {
  id: 'checkout',
  name: 'Store',
  rootPath: '/checkout',
  lastActiveAt: '2026-11-26T00:00:00Z',
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('库入口只将所选品牌文件和 Figma 引用提交给项目预览，不请求 Figma 或发布作品', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const preview: DesignSystemPreviewInput[] = []
  const urls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const path = String(url)
    urls.push(path)
    switch (path) {
      case '/api/v1/projects':
        return Response.json({ projects: [project] })
      case '/api/v1/artifacts':
        return Response.json({ artifacts: [] })
      case '/api/v1/favorites':
        return Response.json({ artifactIds: [] })
      case '/api/v1/agent/connections':
        return Response.json({ connections: [] })
      case '/api/v1/projects/checkout/design-systems/preview':
        preview.push(JSON.parse(String(options?.body)))
        return new Response(null, { status: 403 })
      default:
        return new Response(null, { status: 404 })
    }
  })
  const open = vi.fn()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LibraryShell onOpenArtifact={open} />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '导入设计系统' }))
  const dialog = within(await screen.findByRole('dialog', { name: '导入设计系统' }))
  const logo = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'wordmark.svg')
  fireEvent.change(dialog.getByLabelText('选择文件'), { target: { files: [logo] } })
  fireEvent.click(dialog.getByText('添加所选文件'))
  await dialog.findByLabelText('移除 wordmark.svg')
  const url = 'https://www.figma.com/design/abc123/Checkout'
  fireEvent.change(dialog.getByLabelText('Figma 参考链接'), { target: { value: url } })
  fireEvent.click(dialog.getByText('添加参考'))
  expect(preview).toHaveLength(0)
  fireEvent.click(dialog.getByText('预览品牌资料'))
  await dialog.findByRole('alert')
  expect(preview[0]).toMatchObject({
    buildApproved: false,
    draft: {
      components: [],
      files: [
        {
          kind: 'logo',
          path: logo.name,
          content: btoa('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        },
        { kind: 'figma', content: url },
      ],
    },
  })
  expect(dialog.getByRole<HTMLButtonElement>('button', { name: '保存系统版本' }).disabled).toBe(
    true,
  )
  expect(dialog.getByLabelText('移除 wordmark.svg')).toBeDefined()
  expect(urls.some((path) => path.includes('figma.com') || path.endsWith('/publish'))).toBe(false)
  expect(open).not.toHaveBeenCalled()
})
