import { z } from 'zod'

interface Mailbox {
  email: string
  verified: boolean
  primary: boolean
}

const userIds = { owner: 101, member: 202, guest: 303, other: 404, admin: 505 }

/** 只替换 GitHub HTTP 边界；每个请求读取当前邮箱、组织和组成员表。 */
export function githubProvider() {
  const users = new Map(Object.entries(userIds))
  const organization = new Set(['owner', 'member', 'admin'])
  const groups = new Map([['design', new Set(['member'])]])
  const organizationProfile = { id: 1101, login: 'studio' }
  const groupIds = new Map([['design', 2202]])
  const mailboxes = new Map<string, Mailbox[]>(
    [...users.keys()].map((login) => [
      login,
      [{ email: `${login}@example.net`, verified: true, primary: true }],
    ]),
  )
  const notFound = () => Response.json({ message: 'Not Found' }, { status: 404 })
  const membership = (active: boolean) => (active ? Response.json({ state: 'active' }) : notFound())
  const profile = (login: string) => {
    const id = users.get(login)
    return id ? Response.json({ id, login }) : notFound()
  }
  const providerFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.href === 'https://github.com/login/oauth/access_token' && request.method === 'POST') {
      const { code } = z.object({ code: z.string() }).parse(await request.json())
      return users.has(code) ? Response.json({ access_token: `fixture-${code}` }) : notFound()
    }
    const login = request.headers.get('authorization')?.replace(/^Bearer fixture-/, '')
    if (!login || !users.has(login) || url.host !== 'api.github.com') return notFound()
    if (url.pathname === '/user') return profile(login)
    if (url.pathname === '/user/emails') return Response.json(mailboxes.get(login) ?? [])
    if (url.pathname === '/orgs/studio') return Response.json(organizationProfile)
    if (url.pathname === '/user/memberships/orgs/studio') return membership(organization.has(login))
    const [, resource, name, relation, subject, memberPath, teamUser] = url.pathname.split('/')
    if (resource === 'users' && name) return profile(name.toLowerCase())
    if (resource === 'orgs' && name === 'studio' && subject) {
      if (relation === 'memberships') return membership(organization.has(subject))
      if (relation === 'teams' && !memberPath) {
        const id = groupIds.get(subject)
        return id
          ? Response.json({ id, slug: subject, organization: organizationProfile })
          : notFound()
      }
      if (relation === 'teams' && memberPath === 'memberships' && teamUser) {
        return membership(
          groupIds.has(subject) &&
            organization.has(teamUser) &&
            !!groups.get(subject)?.has(teamUser),
        )
      }
    }
    throw new Error(`意外的 GitHub 请求：${request.method} ${url.pathname}`)
  }
  return {
    organization,
    groups,
    organizationProfile,
    groupIds,
    mailboxes,
    oauth: {
      clientId: 'hub-invitations-test',
      clientSecret: 'test-client-secret',
      signingSecret: 'shared-signing-secret-for-tests-only',
      adminIds: [String(userIds.admin)],
      organization: 'studio',
      fetch: providerFetch,
    },
  }
}
