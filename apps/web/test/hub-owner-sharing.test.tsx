// @vitest-environment jsdom
import type {
  Artifact,
  HubArtifactSharing,
  HubGrantSummary,
  HubInviteInput,
  VersionSummary,
} from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArtifactShareDialog } from '../src/features/artifact-delivery'
import { setLocale } from '../src/shared/i18n'

const artifact: Artifact = {
  publicId: 'OwnerShare001',
  projectId: 'studio',
  slug: 'flow',
  type: 'artboard',
  visibility: 'private',
  title: '结账页',
  headVersion: 3,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-24T10:00:00.000Z',
}
const version: VersionSummary = {
  artifactId: artifact.publicId,
  version: 3,
  parentVersion: 2,
  author: 'human:web',
  title: artifact.title,
  createdAt: '2026-11-24T10:00:00.000Z',
}

const sharingPath = '/api/v1/artifacts/OwnerShare001/sharing'
const onlyMePath = `${sharingPath}/only-me`
const invitationsPath = '/api/v1/artifacts/OwnerShare001/invitations'
const grantPath = (grantId: string) => `${sharingPath}/grants/${grantId}`
const inviteUrl = (id: string) => `https://hub.example.test/invite/${id}`
const expiresAt = '2026-11-26T10:00:00.000Z'

// 有状态的服务端桩：授权写操作同步改写 GET 返回，验证界面按重取结果收敛。
let sharing: HubArtifactSharing
let invitationSeq = 0

const resetSharing = () => {
  sharing = {
    restricted: false,
    organization: 'akasha-labs',
    policy: { externalLinks: true, externalEmail: false },
    grants: [
      {
        id: 'grant-link',
        target: { kind: 'link' },
        entry: { kind: 'artifact' },
        role: 'comment',
        expiresAt,
        accepted: false,
      },
      {
        id: 'grant-member',
        target: { kind: 'member', login: 'octocat' },
        entry: { kind: 'artifact' },
        role: 'edit',
        expiresAt,
        accepted: true,
      },
      {
        id: 'grant-email',
        target: { kind: 'email', email: 'alice@example.com' },
        entry: { kind: 'artifact' },
        role: 'view',
        expiresAt,
        accepted: false,
      },
    ],
  }
  invitationSeq = 0
}

const handleFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url === sharingPath && method === 'GET') return Response.json(sharing)
  if (url === onlyMePath && method === 'POST') {
    sharing = { ...sharing, restricted: true, grants: [] }
    return Response.json({ ok: true })
  }
  if (url === invitationsPath && method === 'POST') {
    invitationSeq += 1
    const body = JSON.parse(String(init?.body)) as HubInviteInput
    const id = `grant-inv-${invitationSeq}`
    sharing = {
      ...sharing,
      restricted: true,
      grants: [
        ...sharing.grants,
        {
          id,
          target: body.target,
          entry: { kind: 'artifact' },
          role: body.role,
          expiresAt,
          accepted: false,
        },
      ],
    }
    return Response.json({ id, url: inviteUrl(id), expiresAt }, { status: 201 })
  }
  const grant = /^\/api\/v1\/artifacts\/OwnerShare001\/sharing\/grants\/(.+)$/.exec(url)
  if (grant && method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as { role: HubGrantSummary['role'] }
    sharing = {
      ...sharing,
      grants: sharing.grants.map((item) =>
        item.id === grant[1] ? { ...item, role: body.role } : item,
      ),
    }
    return Response.json({ ok: true })
  }
  if (grant && method === 'DELETE') {
    sharing = { ...sharing, grants: sharing.grants.filter((item) => item.id !== grant[1]) }
    return Response.json({ ok: true })
  }
  return Response.json({ error: { code: 'NOT_FOUND', message: '未实现' } }, { status: 404 })
}

const renderDialog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ArtifactShareDialog artifact={artifact} version={version} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetSharing()
})

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

it('所有者打开弹框：同源读取设置，展示组织配置、策略与当前授权', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  await screen.findByRole('dialog', { name: '管理作品分享' })
  expect(await screen.findByText('组织：akasha-labs')).toBeTruthy()
  expect(screen.getByText('沿用作品原有的可见性，另加下列授权。')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '当前授权' })).toBeTruthy()
  expect(screen.getByText('普通链接')).toBeTruthy()
  expect(screen.getByText('成员 @octocat')).toBeTruthy()
  expect(screen.getByText('已接受')).toBeTruthy()
  expect(screen.getByText('邮箱 alice@example.com')).toBeTruthy()
  expect(screen.getByText('待接受')).toBeTruthy()
  expect(request).toHaveBeenCalledWith(
    sharingPath,
    expect.objectContaining({ credentials: 'same-origin' }),
  )
})

it('未配置组织且停用外链与邮箱时：隐藏组织与团队邀请并提示策略限制', async () => {
  vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  sharing = {
    ...sharing,
    organization: null,
    policy: { externalLinks: false, externalEmail: false },
  }
  renderDialog()
  await screen.findByText('管理员已停用普通链接；已发出的链接不能再访问。')
  expect(screen.queryByText(/组织：/)).toBeNull()
  expect(screen.queryByRole('button', { name: '创建链接' })).toBeNull()
  const target = screen.getByRole('combobox', { name: '邀请对象' })
  fireEvent.click(target)
  expect(screen.queryByRole('option', { name: '组织全体成员' })).toBeNull()
  expect(screen.queryByRole('option', { name: '团队' })).toBeNull()
  expect(screen.getByRole('option', { name: '点名成员' })).toBeTruthy()
  fireEvent.click(screen.getByRole('option', { name: '邮箱地址' }))
  expect(screen.getByText('邮箱邀请仅接受已验证的 Hub 成员邮箱。')).toBeTruthy()
})

it('创建点名成员邀请：发出同源请求并展示可复制的邀请链接，列表出现待接受', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderDialog()
  await screen.findByText('成员 @octocat')
  fireEvent.change(screen.getByRole('textbox', { name: 'GitHub 用户名' }), {
    target: { value: 'monalisa' },
  })
  fireEvent.click(screen.getByRole('button', { name: '邀请' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      invitationsPath,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          target: { kind: 'member', login: 'monalisa' },
          role: 'view',
          ttlSeconds: 86400,
        }),
      }),
    )
  })
  const link = await screen.findByRole<HTMLInputElement>('textbox', { name: '邀请链接' })
  expect(link.value).toBe(inviteUrl('grant-inv-1'))
  fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl('grant-inv-1')))
  expect(screen.getByRole('button', { name: '已复制' })).toBeTruthy()
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'GitHub 用户名' }).value).toBe('')
  expect(await screen.findByText('成员 @monalisa')).toBeTruthy()
  expect(screen.getByText('仅所有者与下列授权可访问。')).toBeTruthy()
})

it('降权与撤回：角色走 PATCH，撤回需确认并走 DELETE', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  const roleSelect = await screen.findByRole('combobox', { name: '成员 @octocat 的权限' })
  expect(roleSelect.textContent).toContain('可编辑最新版本')
  fireEvent.click(roleSelect)
  fireEvent.click(screen.getByRole('option', { name: '可批注' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      grantPath('grant-member'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'comment' }) }),
    )
  })
  await waitFor(() => expect(roleSelect.textContent).toContain('可批注'))

  fireEvent.click(screen.getByRole('button', { name: '撤回 普通链接' }))
  const confirm = await screen.findByRole('alertdialog', { name: '撤回「普通链接」的访问？' })
  fireEvent.click(within(confirm).getByRole('button', { name: '撤回' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      grantPath('grant-link'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
  await waitFor(() => expect(screen.queryByText('普通链接')).toBeNull())
})

it.each([
  { kind: 'version', version: 1 },
  { kind: 'play', version: 1, pageId: '', boardId: 'main' },
] as const)('固定 $kind 链接可切换查看和批注，不提供编辑', async (entry) => {
  sharing.grants = sharing.grants.map((grant) =>
    grant.target.kind === 'link' ? { ...grant, entry } : grant,
  )
  vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  const role = await screen.findByRole('combobox', { name: '普通链接 的权限' })
  fireEvent.click(role)
  expect(screen.queryByRole('option', { name: '可编辑最新版本' })).toBeNull()
  expect(screen.getByRole('option', { name: '可批注' })).toBeTruthy()
  fireEvent.click(screen.getByRole('option', { name: '仅查看' }))
  await waitFor(() => expect(role.textContent).toContain('仅查看'))
})

it('全作品普通链接可改为编辑最新版本', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  const role = await screen.findByRole('combobox', { name: '普通链接 的权限' })
  fireEvent.click(role)
  fireEvent.click(screen.getByRole('option', { name: '可编辑最新版本' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      grantPath('grant-link'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ role: 'edit' }) }),
    )
  })
})

it('行内复制既有邀请地址；普通链接行不提供复制', async () => {
  vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderDialog()
  await screen.findByText('成员 @octocat')
  const copy = screen.getByRole('button', { name: '复制邀请 成员 @octocat' })
  fireEvent.click(copy)
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/grant-member`),
  )
  await waitFor(() => expect(copy.textContent).toContain('已复制'))
  expect(screen.queryByRole('button', { name: '复制邀请 普通链接' })).toBeNull()
})

it('仅本人可访问：确认后清理全部授权，列表回到空态', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  await screen.findByText('成员 @octocat')
  fireEvent.click(screen.getByRole('button', { name: '仅本人可访问' }))
  const confirm = await screen.findByRole('alertdialog', { name: '撤清所有授权，仅本人可访问？' })
  fireEvent.click(within(confirm).getByRole('button', { name: '仅本人可访问' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      onlyMePath,
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })
  expect(await screen.findByText('还没有授权')).toBeTruthy()
  expect(screen.getByText('当前仅本人可访问。')).toBeTruthy()
  expect(screen.queryByText('成员 @octocat')).toBeNull()
})

it('读取失败展示错误并可重试；403 与 404 不当作空授权', async () => {
  const request = vi.spyOn(window, 'fetch')
  request.mockImplementationOnce(async () =>
    Response.json({ error: { code: 'INTERNAL_ERROR', message: '服务暂不可用' } }, { status: 503 }),
  )
  request.mockImplementation(handleFetch)
  renderDialog()
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('分享设置加载失败：服务暂不可用')
  expect(screen.queryByText('还没有授权')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('成员 @octocat')).toBeTruthy()
  cleanup()

  vi.spyOn(window, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 'FORBIDDEN', message: '只有所有者可以管理' } }, { status: 403 }),
  )
  renderDialog()
  const denied = await screen.findByRole('alert')
  expect(denied.textContent).toBe('只有作品所有者可以管理分享。')
  expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  expect(screen.queryByText('还没有授权')).toBeNull()
  cleanup()

  vi.spyOn(window, 'fetch').mockResolvedValue(
    Response.json({ error: { code: 'NOT_FOUND', message: '作品不存在' } }, { status: 404 }),
  )
  renderDialog()
  const missing = await screen.findByRole('alert')
  expect(missing.textContent).toBe('分享设置加载失败：作品不存在')
  expect(screen.queryByText('还没有授权')).toBeNull()
})

it('English: grants, organization display and the member invite flow', async () => {
  setLocale('en')
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  renderDialog()
  await screen.findByRole('dialog', { name: 'Manage artifact sharing' })
  expect(await screen.findByText('Organization: akasha-labs')).toBeTruthy()
  expect(
    screen.getByText('The artifact keeps its original visibility, plus the grants listed below.'),
  ).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Current grants' })).toBeTruthy()
  expect(screen.getByText('Ordinary link')).toBeTruthy()
  expect(screen.getByText('Member @octocat')).toBeTruthy()
  expect(screen.getByText('Accepted')).toBeTruthy()
  expect(screen.getByText('Email alice@example.com')).toBeTruthy()
  expect(screen.getAllByText('Pending').length).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: 'Copy invite for Member @octocat' }))
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/grant-member`),
  )

  fireEvent.change(screen.getByRole('textbox', { name: 'GitHub username' }), {
    target: { value: 'monalisa' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Invite' }))
  await waitFor(() => {
    expect(request).toHaveBeenCalledWith(
      invitationsPath,
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    )
  })
  const link = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Invite link' })
  expect(link.value).toBe(inviteUrl('grant-inv-1'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(inviteUrl('grant-inv-1')))
  expect(await screen.findByText('Member @monalisa')).toBeTruthy()
  expect(screen.getAllByText('Pending').length).toBe(2)
})

it('保留普通链接签发弹框：从管理弹框打开，关闭后刷新授权列表', async () => {
  const request = vi.spyOn(window, 'fetch').mockImplementation(handleFetch)
  renderDialog()
  await screen.findByText('成员 @octocat')
  fireEvent.click(screen.getByRole('button', { name: '创建链接' }))
  await screen.findByRole('dialog', { name: '创建分享链接' })
  expect(screen.getByRole('combobox', { name: '持链接者权限' })).toBeTruthy()
  const close = screen.getAllByRole('button', { name: '关闭' }).at(-1)
  if (!close) throw new Error('未找到关闭按钮')
  fireEvent.click(close)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '创建分享链接' })).toBeNull())
  expect(screen.getByRole('dialog', { name: '管理作品分享' })).toBeTruthy()
  await waitFor(() => {
    const reads = request.mock.calls.filter((call) => call[0] === sharingPath)
    expect(reads.length).toBeGreaterThanOrEqual(2)
  })
})
