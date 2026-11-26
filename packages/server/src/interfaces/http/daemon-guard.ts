import type { Hono } from 'hono'
import { DomainError } from '../../domain/errors.js'
import type { HttpSecurityConfig } from './dependencies.js'
import { LOCAL_AGENT_TOOL_PATH } from './local-agent.js'

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) out[k] = decodeURIComponent(v)
  }
  return out
}

/** 必须先于业务路由注册。轮次工具只豁免 Daemon 令牌，仍接受 Host 与 Origin 校验。 */
export function mountDaemonGuard(app: Hono, sec: HttpSecurityConfig, scopedTools: boolean) {
  app.use('*', async (c, next) => {
    if (sec.allowedHosts && sec.allowedHosts.length > 0) {
      const host = c.req.header('host')?.toLowerCase()
      if (!host || !sec.allowedHosts.some((h) => h.toLowerCase() === host)) {
        return c.json(
          { error: { code: 'FORBIDDEN', message: `拒绝非法 Host 头 "${host ?? ''}"` } },
          403,
        )
      }
    }
    await next()
  })

  app.use('/api/v1/*', async (c, next) => {
    const method = c.req.method.toUpperCase()
    const isMutation = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    const isWsUpgrade = c.req.header('upgrade')?.toLowerCase() === 'websocket'
    if (isMutation || isWsUpgrade) {
      const origin = c.req.header('origin')
      if (origin && sec.allowedOrigins && !sec.allowedOrigins.includes(origin)) {
        return c.json({ error: { code: 'FORBIDDEN', message: `拒绝跨站 Origin "${origin}"` } }, 403)
      }
    }
    const scopedTool =
      (scopedTools && c.req.path.startsWith(`${LOCAL_AGENT_TOOL_PATH}/`)) ||
      /^\/api\/v1\/projects\/[^/]+\/coding-sessions\/[a-f0-9-]{36}\/(?:read|publish|poll)$/.test(
        c.req.path,
      )
    if (!scopedTool && (isMutation || c.req.path === '/api/v1/withdrawn-artifacts') && sec.token) {
      const auth = c.req.header('authorization')
      const bearerOk = auth === `Bearer ${sec.token}`
      const cookieName = sec.cookieName ?? 'akasha_session'
      const cookies = parseCookies(c.req.header('cookie'))
      const cookieOk = cookies[cookieName] === sec.token
      if (!bearerOk && !cookieOk) {
        return c.json(
          { error: { code: 'UNAUTHORIZED', message: '缺少有效的访问令牌或同源会话凭证' } },
          401,
        )
      }
    }
    await next()
  })
}

/** 浏览器读取 Agent 会话也须有本机凭证，并通过同源校验。 */
export function authorizeAgentSessionRead(
  request: Request,
  security: HttpSecurityConfig,
  token: string,
) {
  const origin = request.headers.get('Origin')
  if (origin && !security.allowedOrigins?.includes(origin))
    throw new DomainError('FORBIDDEN', '拒绝跨站读取本机 Agent 会话')
  const name = security.cookieName ?? 'akasha_session'
  if (
    request.headers.get('Authorization') !== `Bearer ${token}` &&
    parseCookies(request.headers.get('Cookie') ?? undefined)[name] !== token
  )
    throw new DomainError('UNAUTHORIZED', '请先通过本机 Akasha 终端登录')
}
