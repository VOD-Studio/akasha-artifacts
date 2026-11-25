// @vitest-environment jsdom
import type { HubArtifactSharing, HubGrantSummary } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactShareDialog } from '../src/features/artifact-delivery'
import { detailFor } from './canvas-test-fixture'

const { artifact, version } = detailFor()
const base = `/api/v1/artifacts/${artifact.publicId}`
const expiresAt = '2026-12-01T00:00:00Z'
const issuedUrl = 'https://hub.example.test/invite/new-member'
const existing: HubGrantSummary = {
  id: 'old-member',
  target: { kind: 'member', login: 'alice' },
  entry: { kind: 'artifact' },
  role: 'view',
  accepted: true,
  expiresAt,
}

function SharingLauncher() {
  const [open, setOpen] = useState(true)
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        管理分享
      </button>
    )
  }
  return (
    <ArtifactShareDialog artifact={artifact} version={version} onClose={() => setOpen(false)} />
  )
}

function openSharing(issueGate?: Promise<void>, restrictGate?: Promise<void>) {
  let sharing: HubArtifactSharing = {
    restricted: false,
    organization: null,
    policy: { externalLinks: true, externalEmail: true },
    grants: [existing],
  }
  const writes: string[] = []
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).slice(base.length)
    if (path === '/sharing' && !init?.method) return Response.json(sharing)
    writes.push(path)
    if (path === '/invitations' || path === '/share') {
      await issueGate
      const grant: HubGrantSummary = {
        ...existing,
        id: path === '/invitations' ? 'new-member' : 'new-link',
        target: path === '/invitations' ? { kind: 'member', login: 'bob' } : { kind: 'link' },
        accepted: false,
      }
      sharing = { ...sharing, restricted: true, grants: [...sharing.grants, grant] }
      if (path === '/invitations') return Response.json({ id: grant.id, url: issuedUrl, expiresAt })
      return Response.json({ url: 'https://hub.example.test/link/issued', expiresAt })
    }
    if (path === '/sharing/only-me') {
      await restrictGate
      sharing = { ...sharing, restricted: true, grants: [] }
      return Response.json({ ok: true })
    }
    if (path.startsWith('/sharing/grants/') && init?.method === 'DELETE') {
      sharing = { ...sharing, grants: sharing.grants.filter((g) => !path.endsWith(`/${g.id}`)) }
      return Response.json({ ok: true })
    }
    throw new Error(`未预期的请求：${init?.method} ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SharingLauncher />
    </QueryClientProvider>,
  )
  return writes
}

const issueInvite = async () => {
  fireEvent.change(await screen.findByRole('textbox', { name: 'GitHub 用户名' }), {
    target: { value: 'bob' },
  })
  fireEvent.click(screen.getByRole('button', { name: '邀请' }))
}

const confirmRestriction = async () => {
  fireEvent.click(screen.getByRole('button', { name: '仅本人可访问' }))
  const dialog = await screen.findByRole('alertdialog', { name: '撤清所有授权，仅本人可访问？' })
  const confirm = within(dialog).getByRole('button', { name: '仅本人可访问' })
  fireEvent.click(confirm)
  return confirm
}

const revokeMember = async (login: string) => {
  fireEvent.click(screen.getByRole('button', { name: `撤回 成员 @${login}` }))
  const dialog = await screen.findByRole('alertdialog', { name: `撤回「成员 @${login}」的访问？` })
  fireEvent.click(within(dialog).getByRole('button', { name: '撤回' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it.each(['/invitations', '/share'])(
  '签发 %s 未返回时，关闭并重开面板也不能撤清或重复签发',
  async (path) => {
    const issue = Promise.withResolvers<void>()
    const restrict = Promise.withResolvers<void>()
    const writes = openSharing(issue.promise, restrict.promise)
    if (path === '/invitations') {
      await issueInvite()
    } else {
      fireEvent.click(await screen.findByRole('button', { name: '创建链接' }))
      const child = await screen.findByRole('dialog', { name: '创建分享链接' })
      fireEvent.click(within(child).getByRole('button', { name: '创建链接' }))
      fireEvent.click(within(child).getByRole('button', { name: '关闭' }))
    }
    await waitFor(() => expect(writes).toEqual([path]))
    const onlyMe = () => screen.getByRole<HTMLButtonElement>('button', { name: '仅本人可访问' })
    await waitFor(() => expect(onlyMe().disabled).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByRole('button', { name: '管理分享' }))
    expect(onlyMe().disabled).toBe(true)
    fireEvent.click(onlyMe())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '创建链接' }).disabled).toBe(true)
    await issueInvite()
    expect(writes).toEqual([path])

    issue.resolve()
    await waitFor(() => expect(onlyMe().disabled).toBe(false))
    expect(await screen.findByText(path === '/share' ? '普通链接' : '成员 @bob')).toBeTruthy()
    const confirm = await confirmRestriction()
    fireEvent.click(confirm)
    await waitFor(() => expect(writes).toEqual([path, '/sharing/only-me']))
    restrict.resolve()
    expect(await screen.findByText('当前仅本人可访问。')).toBeTruthy()
    expect(writes).toEqual([path, '/sharing/only-me'])
  },
)

it.each(['撤回该邀请', '仅本人可访问'])(
  '%s 后移除回执与复制入口，撤回其他人不影响它',
  async (action) => {
    openSharing()
    await issueInvite()
    const receipt = () => screen.queryByRole<HTMLInputElement>('textbox', { name: '邀请链接' })
    await waitFor(() => expect(receipt()?.value).toBe(issuedUrl))
    await revokeMember('alice')
    expect(receipt()?.value).toBe(issuedUrl)
    expect(screen.getByRole('button', { name: '复制链接' })).toBeTruthy()
    if (action === '撤回该邀请') await revokeMember('bob')
    else await confirmRestriction()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    await waitFor(() => expect(screen.queryByText('成员 @bob')).toBeNull())
    expect(receipt()).toBeNull()
    expect(screen.queryByRole('button', { name: '复制链接' })).toBeNull()
    expect(screen.queryByRole('button', { name: '复制邀请 成员 @bob' })).toBeNull()
  },
)

it('重取发现刚签发的邀请已失效时，以服务端清单为准', async () => {
  openSharing()
  await issueInvite()
  expect(await screen.findByRole('textbox', { name: '邀请链接' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '创建链接' }))
  const child = await screen.findByRole('dialog', { name: '创建分享链接' })
  vi.mocked(window.fetch).mockResolvedValueOnce(
    Response.json({
      restricted: true,
      organization: null,
      policy: { externalLinks: true, externalEmail: true },
      grants: [existing],
    } satisfies HubArtifactSharing),
  )
  fireEvent.click(within(child).getByRole('button', { name: '关闭' }))
  await waitFor(() => expect(screen.queryByText('成员 @bob')).toBeNull())
  expect(screen.queryByRole('textbox', { name: '邀请链接' })).toBeNull()
  expect(screen.queryByRole('button', { name: '复制链接' })).toBeNull()
  expect(screen.getByRole('button', { name: '复制邀请 成员 @alice' })).toBeTruthy()
})
