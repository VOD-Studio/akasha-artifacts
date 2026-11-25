import type { Hono } from 'hono'
import { z } from 'zod'
import type { HttpSecurityConfig } from '../dependencies.js'
import { parseJsonBody } from '../request-body.js'

const OtcCreateBodySchema = z.object({
  // 仅允许站内相对路径，防止开放重定向
  next: z
    .string()
    .regex(/^\/(?!\/)[^\r\n]*$/, 'next 须为站内相对路径')
    .optional()
    .default('/'),
})

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 一次性登录码只在签发它的应用实例内消费。 */
export function mountBrowserSessionRoutes(app: Hono, security?: HttpSecurityConfig) {
  // 一次性浏览器登录码：60 秒有效且仅可消费一次，用于 akasha open 换取 HttpOnly Cookie
  const otcStore = new Map<string, { next: string; expiresAt: number }>()

  app.post('/api/v1/auth/otc', async (c) => {
    const body = await parseJsonBody(c.req.raw, OtcCreateBodySchema)
    const now = Date.now()
    for (const [k, v] of otcStore.entries()) {
      if (v.expiresAt <= now) otcStore.delete(k)
    }
    const code = randomHex(16)
    otcStore.set(code, { next: body.next, expiresAt: now + 60_000 })
    return c.json({ code, openPath: `/auth/open?otc=${code}` }, 201)
  })

  app.get('/auth/open', (c) => {
    const code = c.req.query('otc')
    if (!code) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: '缺少一次性访问码' } }, 401)
    }
    const entry = otcStore.get(code)
    otcStore.delete(code)
    if (!entry || entry.expiresAt <= Date.now()) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: '一次性访问码无效或已过期' } }, 401)
    }
    if (security?.token) {
      const cookieName = security.cookieName ?? 'akasha_session'
      c.header(
        'Set-Cookie',
        `${cookieName}=${encodeURIComponent(security.token)}; HttpOnly; SameSite=Lax; Path=/`,
      )
    }
    return c.redirect(entry.next, 302)
  })
}
