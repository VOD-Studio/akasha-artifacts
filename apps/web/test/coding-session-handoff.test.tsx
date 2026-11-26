// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactHandoffDialog } from '../src/features/artifact-delivery'
import { setLocale } from '../src/shared/i18n'

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  delete window.__AKASHA_CONFIG__
  vi.restoreAllMocks()
})

it('显示目标终端的连接操作并只向选中的编码会话移交固定选区', async () => {
  window.__AKASHA_CONFIG__ = { hub: true }
  setLocale('en')
  const reference = {
    artifactId: 'CheckoutArtifact001',
    projectId: 'github-101:design',
    version: 2,
    pageId: 'checkout',
    boardId: 'order',
    element: { selector: '#pay' },
  }
  const root = '/api/v1/projects/github-101%3Adesign/coding-sessions'
  const id = '52948d56-7df6-4bf5-a3cb-296ffa18fc26'
  let available = false
  let bound = false
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(JSON.parse(String(init?.body))).toEqual(reference)
    const target = { id, label: 'remote-checkout', bound }
    if (String(url) === `${root}/targets`) return Response.json(available ? [target] : [])
    expect(String(url)).toBe(`${root}/${id}/bind`)
    bound = true
    return Response.json({ ...target, bound })
  })
  const open = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ArtifactHandoffDialog target={{ reference, label: 'Order' }} onClose={() => {}} />
      </QueryClientProvider>,
    )
  const dialog = open()
  expect((await screen.findByText(/akasha login --hub/)).textContent).toContain(
    "--project-id 'github-101:design'",
  )
  available = true
  fireEvent.click(screen.getByRole('button', { name: 'Refresh targets' }))
  fireEvent.click(await screen.findByRole('button', { name: /Hand off to remote-checkout/ }))
  await screen.findByText('Bound to remote-checkout')
  expect(screen.getByRole('link', { name: 'Open coding workspace' }).getAttribute('href')).toBe(
    `/coding/github-101%3Adesign/${id}`,
  )
  expect(screen.getByText(/claude mcp add/).textContent).toContain(
    `akasha coding mcp --session ${id}`,
  )
  dialog.unmount()
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Resume remote-checkout/ }))
  await screen.findByText('Bound to remote-checkout')
})
