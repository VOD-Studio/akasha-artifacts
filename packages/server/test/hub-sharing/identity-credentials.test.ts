import { expect, it, vi } from 'vitest'
import { createMemoryContainer } from '../../src/app/create-memory-container.js'
import { createGitHubDirectory } from '../../src/interfaces/http/hub-sharing/github-directory.js'
import { origin } from './browser-client.js'
import { githubProvider } from './github-provider.js'

it('共享存储不含明文令牌或邮箱索引，密文只能供同一 Hub 的同一账号使用', async () => {
  const { sharing } = createMemoryContainer().repositories
  const saved = vi.spyOn(sharing, 'saveIdentitySecret')
  const { oauth } = githubProvider()
  const directory = createGitHubDirectory(oauth, origin, sharing)
  await directory.login('member')
  const record = saved.mock.calls[0]
  if (!record) throw new Error('登录未持久化目录凭据')
  const [id, ciphertext, keys] = record
  expect(id).toBe('202')
  expect(keys).toHaveLength(1)
  expect(JSON.stringify(record)).not.toMatch(/fixture-member|member@example\.net/)
  expect(await sharing.findIdentityByEmailKey('member@example.net')).toEqual([])
  const replica = createGitHubDirectory(oauth, origin, sharing)
  const member = await replica.authenticate(id, 'session')
  expect(member).toEqual({ userId: id, login: 'member', member: true, kind: 'session' })
  if (!member) throw new Error('另一副本无法认证同一个账号')
  expect(await replica.authority.verifiedEmails(member)).toEqual(['member@example.net'])
  expect(await replica.authority.isInternalEmail('MEMBER@example.net')).toBe(true)
  await sharing.saveIdentitySecret('303', ciphertext, keys)
  expect(await replica.authenticate('303', 'session')).toBeUndefined()
  const otherOrigin = createGitHubDirectory(oauth, 'https://other-hub.example.org', sharing)
  expect(await otherOrigin.authenticate(id, 'session')).toBeUndefined()
  expect(await otherOrigin.authority.isInternalEmail('member@example.net')).toBe(false)
})

it('CLI 不继承登录时的成员标记，目录不可用时不允许使用旧权限', async () => {
  const { sharing } = createMemoryContainer().repositories
  const provider = githubProvider()
  const directory = createGitHubDirectory(provider.oauth, origin, sharing)
  await directory.login('member')
  expect(await directory.authenticate('202', 'cli')).toMatchObject({ member: true })
  provider.organization.delete('member')
  expect(await directory.authenticate('202', 'cli')).toBeUndefined()
  expect(await directory.authenticate('202', 'session')).toMatchObject({ member: false })
  expect(await directory.authority.isInternalEmail('member@example.net')).toBe(false)
  const offline = createGitHubDirectory(
    { ...provider.oauth, fetch: async () => new Response(null, { status: 503 }) },
    origin,
    sharing,
  )
  expect(await offline.authenticate('202', 'session')).toBeUndefined()
  expect(await offline.authority.isInternalEmail('member@example.net')).toBe(false)
})

it('默认团队之外的组织成员可以匹配组织邀请，但不因此成为 Hub 成员或组成员', async () => {
  const { sharing } = createMemoryContainer().repositories
  const { oauth } = githubProvider()
  const directory = createGitHubDirectory({ ...oauth, team: 'design' }, origin, sharing)
  await directory.login('owner')
  const user = await directory.authenticate('101', 'session')
  if (!user) throw new Error('未取得浏览器身份')
  expect(user.member).toBe(false)
  expect(await directory.authority.belongsTo(user, { kind: 'organization' })).toBe(true)
  expect(await directory.authority.belongsTo(user, { kind: 'group', slug: 'design' })).toBe(false)
  expect(await directory.authenticate('101', 'cli')).toBeUndefined()
})
