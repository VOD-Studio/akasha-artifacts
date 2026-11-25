import { z } from 'zod'
import type {
  HubAudienceTarget,
  HubIdentityAuthority,
  HubPrincipal,
} from '../../../application/hub-sharing/authority.js'
import type { HubIdentityStore } from '../../../domain/hub-sharing.js'
import type { HubOAuthOptions } from '../hub-auth.js'
import { createIdentityVault } from './identity-vault.js'

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
})
const teamSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string(),
  organization: userSchema,
})
const membershipSchema = z.object({ state: z.enum(['active', 'pending']) })
const emailsSchema = z.array(z.object({ email: z.string(), verified: z.boolean() }))

type Profile = Pick<HubPrincipal, 'userId' | 'login'>
interface Account {
  user: Profile
  readUser(path: string): Promise<Profile | undefined>
  resolveAudienceId(target: HubAudienceTarget): Promise<string | undefined>
  member(login: string): Promise<boolean>
  inOrg(login: string): Promise<boolean>
  inTeam(login: string, slug: string): Promise<boolean>
  emails(): Promise<readonly string[]>
}

function githubApi(fetchGithub: typeof fetch, token: string) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'akasha-hub',
  }
  const get = async (path: string) => {
    const response = await fetchGithub(`https://api.github.com${path}`, {
      headers,
      redirect: 'error',
    })
    if (!response.ok && response.status !== 404) throw new Error('GitHub 目录不可用')
    return response
  }
  const readUser = async (path: string) => {
    const response = await get(path)
    if (!response.ok) return
    const { id, login } = userSchema.parse(await response.json())
    return { userId: String(id), login: login.toLowerCase() }
  }
  const readAudienceId = async (organization: string, target: HubAudienceTarget) => {
    const orgPath = `/orgs/${encodeURIComponent(organization)}`
    if (target.kind === 'organization') {
      const response = await get(orgPath)
      if (!response.ok) return
      const org = userSchema.parse(await response.json())
      if (org.login.toLowerCase() === organization.toLowerCase()) return `github:org:${org.id}`
      return
    }
    const response = await get(`${orgPath}/teams/${encodeURIComponent(target.slug)}`)
    if (!response.ok) return
    // 团队元数据本身携带所属组织；两个 ID 必须来自同一次目录读取。
    const team = teamSchema.parse(await response.json())
    if (
      team.organization.login.toLowerCase() === organization.toLowerCase() &&
      team.slug.toLowerCase() === target.slug.toLowerCase()
    )
      return `github:org:${team.organization.id}:team:${team.id}`
  }
  const active = async (path: string) => {
    const response = await get(path)
    return response.ok && membershipSchema.parse(await response.json()).state === 'active'
  }
  const emails = async () => {
    const verified = new Set<string>()
    for (let page = 1; ; page++) {
      const response = await get(`/user/emails${page === 1 ? '' : `?page=${page}`}`)
      if (!response.ok) throw new Error('无法核对已验证邮箱')
      for (const item of emailsSchema.parse(await response.json())) {
        if (item.verified) verified.add(item.email.toLowerCase())
      }
      // 下一页仍调用同一个私有接口，绝不把 Authorization 转发到 Link 指定的地址。
      if (!response.headers.get('link')?.includes('rel="next"')) return [...verified]
    }
  }
  return { readUser, readAudienceId, active, emails }
}

/** 以数字 ID 绑定登录和凭据；每份请求身份单独核验，签名里旧的成员标记不参与决策。 */
export function createGitHubDirectory(
  options: HubOAuthOptions,
  origin: string,
  store: HubIdentityStore,
) {
  const fetchGithub = options.fetch ?? fetch
  const vault = createIdentityVault(store, options.signingSecret, origin)
  const allowlist = new Set(options.allowlist?.map((login) => login.trim().toLowerCase()))
  const admins = new Set(options.adminIds)
  const organization = options.organization
  const org = organization && encodeURIComponent(organization)

  const load = async (token: string, expectedId?: string): Promise<Account | undefined> => {
    const api = githubApi(fetchGithub, token)
    const user = await api.readUser('/user')
    if (!user || (expectedId !== undefined && user.userId !== expectedId)) return
    const memberships = new Map<string, Promise<boolean>>()
    const active = (path: string) => {
      const found = memberships.get(path)
      if (found) return found
      const result = api.active(path)
      memberships.set(path, result)
      return result
    }
    const inOrg = async (login: string) => {
      if (!org) return false
      return active(
        login === user.login
          ? `/user/memberships/orgs/${org}`
          : `/orgs/${org}/memberships/${encodeURIComponent(login)}`,
      )
    }
    const inTeam = async (login: string, slug: string) =>
      !!org &&
      active(
        `/orgs/${org}/teams/${encodeURIComponent(slug)}/memberships/${encodeURIComponent(login)}`,
      )
    const member = async (login: string) => {
      if (allowlist.has(login)) return true
      if (!(await inOrg(login))) return false
      return !options.team || inTeam(login, options.team)
    }
    const audienceIds = new Map<string, Promise<string | undefined>>()
    const resolveAudienceId = async (target: HubAudienceTarget) => {
      if (!organization) return
      const key = target.kind === 'group' ? `team:${target.slug.toLowerCase()}` : 'organization'
      const cached = audienceIds.get(key)
      if (cached) return cached
      const result = api.readAudienceId(organization, target)
      audienceIds.set(key, result)
      return result
    }
    let verified: Promise<readonly string[]> | undefined
    const emails = () => (verified ??= api.emails())
    return { user, member, inOrg, inTeam, emails, resolveAudienceId, readUser: api.readUser }
  }
  // CLI/HTTP/每条实时事件都重新 authenticate；只在同一轮目录操作中合并相同的请求。
  const accounts = new WeakMap<HubPrincipal, Account>()
  const accountFor = async (id: string) => {
    const token = await vault.open(id)
    return token ? load(token, id) : undefined
  }
  const login = async (code: string) => {
    const response = await fetchGithub('https://github.com/login/oauth/access_token', {
      method: 'POST',
      redirect: 'error',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code,
        redirect_uri: `${origin}/auth/github/callback`,
      }),
    })
    if (!response.ok) return
    const { access_token: token } = z
      .object({ access_token: z.string().min(1).max(4096) })
      .parse(await response.json())
    const account = await load(token)
    if (!account) return
    const [member, emails] = await Promise.all([
      account.member(account.user.login),
      account.emails(),
    ])
    await vault.save(account.user.userId, token, emails)
    return { ...account.user, member }
  }
  const authenticate = async (
    id: string,
    kind: HubPrincipal['kind'],
  ): Promise<HubPrincipal | undefined> => {
    try {
      const account = await accountFor(id)
      if (!account) return
      const member = await account.member(account.user.login)
      if (kind === 'cli' && !member) return
      const principal = { ...account.user, member, kind }
      accounts.set(principal, account)
      return principal
    } catch {
      return undefined
    }
  }
  const authority: HubIdentityAuthority = {
    organization,
    isAdministrator: (principal) => principal.kind === 'session' && admins.has(principal.userId),
    async lookupMember(principal, login) {
      const account = accounts.get(principal)
      if (!account || !principal.member || principal.kind !== 'session') return
      try {
        const user = await account.readUser(`/users/${encodeURIComponent(login)}`)
        if (user && user.login === login.toLowerCase() && (await account.member(user.login)))
          return user
      } catch {
        return undefined
      }
    },
    async verifiedEmails(principal) {
      const account = accounts.get(principal)
      if (!account || principal.kind !== 'session') return []
      try {
        return await account.emails()
      } catch {
        return []
      }
    },
    async resolveAudienceId(principal, target) {
      const account = accounts.get(principal)
      if (!account || principal.kind !== 'session') return
      try {
        return await account.resolveAudienceId(target)
      } catch {
        return undefined
      }
    },
    async belongsTo(principal, target) {
      const account = accounts.get(principal)
      if (!account || principal.kind !== 'session') return false
      try {
        if (!(await account.inOrg(account.user.login))) return false
        return (
          target.kind === 'organization' || (await account.inTeam(account.user.login, target.slug))
        )
      } catch {
        return false
      }
    },
    async isInternalEmail(email) {
      const normalized = email.toLowerCase()
      for (const id of await vault.find(normalized)) {
        try {
          const account = await accountFor(id)
          if (
            account &&
            (await account.member(account.user.login)) &&
            (await account.emails()).includes(normalized)
          )
            return true
        } catch {
          // 索引只定位候选人；过期凭据、改邮箱或已离开组织都不能放行。
        }
      }
      return false
    },
  }
  return { login, authenticate, authority }
}
