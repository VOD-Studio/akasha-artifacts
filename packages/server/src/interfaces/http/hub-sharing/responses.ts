import type { Context } from 'hono'

/** 隐藏不存在和不可见资源的区别。 */
export function hidden(c: Context) {
  return c.json({ error: { code: 'NOT_FOUND', message: '未找到请求的资源' } }, 404)
}

/** 只有已知身份或有效作用域凭据才区分缺少操作权限与未登录。 */
export function forbidden(c: Context, credential?: object) {
  return credential
    ? c.json({ error: { code: 'FORBIDDEN', message: '当前权限不允许此操作' } }, 403)
    : c.json({ error: { code: 'UNAUTHORIZED', message: '请先登录 Hub' } }, 401)
}

/** 守卫在请求抵达核心路由前发现的参数错误。 */
export function invalid(c: Context) {
  return c.json({ error: { code: 'BAD_REQUEST', message: '请求参数无效' } }, 400)
}
