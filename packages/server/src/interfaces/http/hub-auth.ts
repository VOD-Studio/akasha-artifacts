import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Clock, ReceiptRepository } from '../../domain/ports.js'

// __Host- 前缀要求 cookie 带 Secure、Path=/ 且不设 Domain，子域名无法覆盖这些 cookie
const sessionCookie = '__Host-akasha_hub_session'
const stateCookie = '__Host-akasha_hub_oauth'
const shareCookie = (artifactId: string) => `__Host-akasha_hub_share_${artifactId}`
const verifierPattern = /^[A-Za-z0-9_-]{43}$/
const sessionTtl = 8 * 60 * 60
const cliTtl = 30 * 24 * 60 * 60
const stateTtl = 10 * 60
const grantTtl = 5 * 60
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface HubOAuthOptions {
  clientId: string
  clientSecret: string
  // 至少 32 字节；用于 HMAC 签名所有凭证
  signingSecret: string
  // 设置后，调用方须是该组织的活跃成员才算 Hub 成员
  organization?: string
  // 在组织内进一步限定到某个团队；须同时设置 `organization`
  team?: string
  // 按 GitHub login 放行的成员白名单，比较时不区分大小写
  allowlist?: readonly string[]
  // 缺省用全局 `fetch`；测试时可替换
  fetch?: typeof fetch
}

const identity = z.object({
  userId: z.string().regex(/^\d+$/),
  login: z.string(),
  member: z.boolean(),
})
const expires = z.object({ exp: z.number().int() })
// 六种凭证共用同一签名格式：session（浏览器会话）、cli（CLI 令牌）、grant（一次性授权码）、
// state（OAuth 防 CSRF）、share（分享链接）、receipt（封装给 CLI 的回执）
const credentials = z.discriminatedUnion('kind', [
  identity.merge(expires).extend({ kind: z.literal('session') }),
  identity.merge(expires).extend({ kind: z.literal('cli') }),
  identity
    .merge(expires)
    .extend({ kind: z.literal('grant'), challenge: z.string(), nonce: z.string() }),
  expires.extend({
    kind: z.literal('state'),
    nonce: z.string(),
    next: z.string(),
    challenge: z.string().optional(),
  }),
  expires.extend({ kind: z.literal('share'), artifactId: z.string() }),
  expires.extend({
    kind: z.literal('receipt'),
    userId: z.string(),
    artifactId: z.string(),
    receipt: z.string(),
  }),
])
type Credential = z.infer<typeof credentials>
interface GitHubIdentity {
  userId: string
  login: string
  member: boolean
}

/** 已通过鉴权的调用方身份。 */
export interface HubPrincipal extends GitHubIdentity {
  // session 来自浏览器 cookie，cli 来自 Bearer 令牌
  kind: 'session' | 'cli'
  // 是否为 Hub 成员；非成员只能读 public 制品
}

export interface HubAuth {
  /** 注册 `/auth/*` 登录路由与 CLI 令牌接口。 */
  mount(app: Hono): void
  /** 凭会话 cookie 或 Bearer 令牌识别调用方；Bearer 只接受 cli 凭证。 */
  authenticate(request: Request): Promise<HubPrincipal | undefined>
  /** 请求是否持有某制品的有效分享链接。 */
  hasShare(request: Request, artifactId: string): Promise<boolean>
  /** 签发一条分享链接；`ttl` 的单位为秒。 */
  createShare(artifactId: string, ttl: number): Promise<{ url: string; expiresAt: string }>
  /** 把回执封装成只对该调用方有效的令牌；Hub 把回执交给 CLI 之前使用。 */
  sealReceipt(principal: HubPrincipal, artifactId: string, receipt: string): Promise<string>
  /** 还原 `sealReceipt` 封装的回执；调用方不一致或已过期时返回 `undefined`。 */
  openReceipt(
    token: string,
    principal: HubPrincipal,
  ): Promise<{ artifactId: string; receipt: string } | undefined>
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  )
}

function random(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

function cookie(request: Request, name: string): string | undefined {
  for (const item of request.headers.get('cookie')?.split(';') ?? []) {
    const field = item.trimStart()
    if (field.startsWith(`${name}=`)) return field.slice(name.length + 1)
  }
}

function cookieHeader(name: string, value: string, ttl: number): string {
  return `${name}=${value}; Max-Age=${ttl}; Path=/; Secure; HttpOnly; SameSite=Lax`
}

// 登录后的跳转目标只接受站内路径，且不能落在 /auth/ 下
function safeNext(value: string | undefined, origin: string): string {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\r\n\t]/.test(value)) return '/'
  const url = new URL(value, origin)
  return url.origin === origin && !url.pathname.startsWith('/auth/')
    ? `${url.pathname}${url.search}${url.hash}`
    : '/'
}

/** 请求是否来自 Hub 自己的 origin：带 `Origin` 头时以它为准，否则看 `sec-fetch-site`。 */
export function sameHubOrigin(request: Request, origin: string): boolean {
  const supplied = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  return supplied !== null
    ? supplied === origin
    : fetchSite !== 'cross-site' && fetchSite !== 'same-site'
}

/**
 * 组装 Hub 鉴权：GitHub OAuth 登录、CLI 授权码换令牌、分享链接与回执封装。
 *
 * @throws {Error} OAuth 配置缺失、签名密钥不足 32 字节，或设置了 `team` 而没有 `organization`。
 */
export function createHubAuth(
  options: HubOAuthOptions,
  origin: string,
  clock: Clock,
  receipts: ReceiptRepository,
): HubAuth {
  if (
    !options.clientId ||
    !options.clientSecret ||
    encoder.encode(options.signingSecret).length < 32
  ) {
    throw new Error('Hub 需要 GitHub OAuth 配置和至少 32 字节的签名密钥')
  }
  if (options.team && !options.organization) throw new Error('GitHub 团队配置需要同时设置组织')
  const allowlist = new Set(options.allowlist?.map((login) => login.trim().toLowerCase()))
  const fetchGithub = options.fetch ?? fetch
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(options.signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  const now = () => Math.floor(Date.parse(clock.now()) / 1000)

  // 签名内容带上 origin，令牌换到别的 Hub 域名下即失效
  async function sign(claim: Credential): Promise<string> {
    const payload = base64url(encoder.encode(JSON.stringify(claim)))
    const mac = await crypto.subtle.sign('HMAC', await key, encoder.encode(`${origin}\n${payload}`))
    return `${payload}.${base64url(new Uint8Array(mac))}`
  }

  async function verify(token: string | undefined): Promise<Credential | undefined> {
    if (!token || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return
    const dot = token.indexOf('.')
    const payload = token.slice(0, dot)
    try {
      if (
        !(await crypto.subtle.verify(
          'HMAC',
          await key,
          decodeBase64url(token.slice(dot + 1)),
          encoder.encode(`${origin}\n${payload}`),
        ))
      )
        return
      const parsed = credentials.safeParse(JSON.parse(decoder.decode(decodeBase64url(payload))))
      if (parsed.success && parsed.data.exp > now()) return parsed.data
    } catch {
      // 畸形凭证不区分具体失败原因。
    }
  }

  async function authenticate(request: Request): Promise<HubPrincipal | undefined> {
    const bearer = request.headers.get('authorization')
    const credential = await verify(
      bearer ? /^Bearer (\S+)$/i.exec(bearer)?.[1] : cookie(request, sessionCookie),
    )
    if (!credential || credential.kind !== (bearer ? 'cli' : 'session')) return
    if (credential.kind === 'cli' || credential.kind === 'session') {
      return {
        kind: credential.kind,
        userId: credential.userId,
        login: credential.login,
        member: credential.member,
      }
    }
  }

  async function hasShare(request: Request, artifactId: string): Promise<boolean> {
    const claim = await verify(cookie(request, shareCookie(artifactId)))
    return claim?.kind === 'share' && claim.artifactId === artifactId
  }

  async function createShare(artifactId: string, ttl: number) {
    const exp = now() + ttl
    const token = await sign({ kind: 'share', artifactId, exp })
    return {
      url: `${origin}/auth/share?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    }
  }

  async function sealReceipt(principal: HubPrincipal, artifactId: string, receipt: string) {
    return sign({
      kind: 'receipt',
      artifactId,
      userId: principal.userId,
      receipt,
      exp: now() + cliTtl,
    })
  }

  async function openReceipt(token: string, principal: HubPrincipal) {
    const claim = await verify(token)
    return claim?.kind === 'receipt' && claim.userId === principal.userId ? claim : undefined
  }

  // 成员资格：命中白名单，或是所配置组织（及团队）的活跃成员
  async function githubIdentity(code: string) {
    const tokenResponse = await fetchGithub('https://github.com/login/oauth/access_token', {
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
    if (!tokenResponse.ok) return
    const token = z
      .object({ access_token: z.string().min(1) })
      .safeParse(await tokenResponse.json())
    if (!token.success) return
    const headers = {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token.data.access_token}`,
      'user-agent': 'akasha-hub',
    }
    const api = (path: string) =>
      fetchGithub(`https://api.github.com${path}`, { headers, redirect: 'error' })
    const response = await api('/user')
    if (!response.ok) return
    const user = z
      .object({ id: z.number().int().positive(), login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/) })
      .safeParse(await response.json())
    if (!user.success) return
    const login = user.data.login.toLowerCase()
    let member = allowlist.has(login)
    if (!member && options.organization) {
      const org = encodeURIComponent(options.organization)
      const membership = await api(`/user/memberships/orgs/${org}`)
      member =
        membership.ok &&
        z.object({ state: z.literal('active') }).safeParse(await membership.json()).success
      if (member && options.team) {
        const team = await api(
          `/orgs/${org}/teams/${encodeURIComponent(options.team)}/memberships/${encodeURIComponent(login)}`,
        )
        member =
          team.ok && z.object({ state: z.literal('active') }).safeParse(await team.json()).success
      }
    }
    return { login, member, userId: String(user.data.id) }
  }

  function mount(app: Hono) {
    // 发起 GitHub OAuth：签一个带 nonce 的 state 存入 cookie，回调时比对
    async function begin(next: string, challenge?: string) {
      const nonce = random()
      const state = await sign({ kind: 'state', nonce, next, challenge, exp: now() + stateTtl })
      const url = new URL('https://github.com/login/oauth/authorize')
      url.searchParams.set('client_id', options.clientId)
      url.searchParams.set('redirect_uri', `${origin}/auth/github/callback`)
      url.searchParams.set('state', nonce)
      if (options.organization) url.searchParams.set('scope', 'read:org')
      return new Response(null, {
        status: 302,
        headers: {
          location: url.toString(),
          'set-cookie': cookieHeader(stateCookie, state, stateTtl),
        },
      })
    }

    app.get('/auth/login', (c) => begin(safeNext(c.req.query('next'), origin)))
    app.get('/auth/cli', (c) => {
      const challenge = c.req.query('challenge')
      if (!challenge || !verifierPattern.test(challenge)) return c.text('CLI 登录证明无效', 400)
      return begin('/', challenge)
    })
    app.get('/auth/github/callback', async (c) => {
      c.header('set-cookie', cookieHeader(stateCookie, '', 0))
      const state = await verify(cookie(c.req.raw, stateCookie))
      const code = c.req.query('code')
      if (state?.kind !== 'state' || c.req.query('state') !== state.nonce || !code) {
        return c.text('GitHub 登录请求已过期或无效', 400)
      }
      let user: GitHubIdentity | undefined
      try {
        user = await githubIdentity(code)
      } catch {
        return c.text('无法完成 GitHub 登录', 502)
      }
      if (!user) return c.text('无法完成 GitHub 登录', 502)
      if (state.challenge && !user.member) return c.text('只有 Hub 成员可以登录 CLI', 403)
      const session = await sign({ ...user, kind: 'session', exp: now() + sessionTtl })
      c.header('set-cookie', cookieHeader(sessionCookie, session, sessionTtl), { append: true })
      if (!state.challenge) return c.redirect(state.next)
      const nonce = random()
      const grant = await sign({
        ...user,
        kind: 'grant',
        nonce,
        challenge: state.challenge,
        exp: now() + grantTtl,
      })
      // 与反馈回执共享原子消费存储，不在实例内保存授权码，保证多副本和冷启动时仍可兑换一次。
      await receipts.save({
        receipt: `hub-cli:${nonce}`,
        artifactId: null,
        cursor: '',
        feedbackIds: [],
        issuedAt: clock.now(),
      })
      return c.text(
        `请将以下授权码粘贴到发起登录的终端。授权码五分钟内有效，请勿转发。\n\n${grant}\n`,
      )
    })
    app.post('/api/v1/auth/cli/token', bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
      const contentType = c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      const body = contentType === 'application/json' ? await c.req.json().catch(() => null) : null
      const parsed = z
        .object({ code: z.string().max(4096), verifier: z.string().regex(verifierPattern) })
        .safeParse(body)
      if (!parsed.success)
        return c.json({ error: { code: 'BAD_REQUEST', message: '授权码或登录证明无效' } }, 400)
      const grant = await verify(parsed.data.code)
      if (grant?.kind !== 'grant' || !grant.member)
        return c.json({ error: { code: 'UNAUTHORIZED', message: '授权码无效或已过期' } }, 401)
      const challenge = base64url(
        new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(parsed.data.verifier))),
      )
      if (challenge !== grant.challenge || !(await receipts.consume(`hub-cli:${grant.nonce}`))) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: '授权码或登录证明已失效' } }, 401)
      }
      const exp = now() + cliTtl
      const token = await sign({
        kind: 'cli',
        login: grant.login,
        userId: grant.userId,
        member: true,
        exp,
      })
      return c.json({ token, expiresAt: new Date(exp * 1000).toISOString() })
    })
    app.get('/api/v1/auth/session', async (c) =>
      c.json({ user: (await authenticate(c.req.raw)) ?? null }),
    )
    app.post('/api/v1/auth/logout', (c) => {
      c.header('set-cookie', cookieHeader(sessionCookie, '', 0))
      return c.json({ ok: true })
    })
    app.get('/auth/share', async (c) => {
      const token = c.req.query('token')
      const claim = await verify(token)
      if (claim?.kind !== 'share' || !token) return c.text('分享链接无效或已过期', 404)
      c.header('set-cookie', cookieHeader(shareCookie(claim.artifactId), token, claim.exp - now()))
      return c.redirect(`/a/${encodeURIComponent(claim.artifactId)}`)
    })
  }

  return { mount, authenticate, hasShare, createShare, sealReceipt, openReceipt }
}
