import { ArtifactSchema, type HubInviteInput } from '@akasha/protocol'
import { expect } from 'vitest'
import { z } from 'zod'

export const origin = 'https://hub.example.com'
export const sandboxOrigin = 'https://preview.example.net'

/** 通过同源 HTTP 使用工作台，凭据完全来自 OAuth 回调或分享地址。 */
export function browserClient(fetchRequest: (request: Request) => Promise<Response> | Response) {
  const send = (path: string, method = 'GET', cookie = '', body?: unknown) =>
    fetchRequest(
      new Request(new URL(path, origin), {
        method,
        headers: {
          cookie,
          origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  const login = async (login: string) => {
    const begin = await send('/auth/login')
    expect(begin.status).toBe(302)
    const state = new URL(begin.headers.get('location') ?? '').searchParams.get('state')
    if (!state) throw new Error('GitHub 登录未提供 state')
    const result = await send(
      `/auth/github/callback?${new URLSearchParams({ state, code: login })}`,
      'GET',
      begin.headers.get('set-cookie')?.split(';')[0],
    )
    expect(result.status).toBe(302)
    const cookie = result.headers
      .getSetCookie()
      .find((value) => value.startsWith('__Host-akasha_hub_session='))
    if (!cookie) throw new Error('OAuth 回调未创建会话')
    return cookie.split(';')[0] ?? ''
  }
  const publish = async (
    owner: string,
    name: string,
    visibility: 'team' | 'private' | 'public' = 'private',
  ) => {
    const response = await send('/api/v1/artifacts', 'POST', owner, {
      slug: `html/${name}`,
      type: 'html',
      title: name,
      source: '<h1>第一稿</h1>',
      visibility,
    })
    expect(response.status).toBe(201)
    const { artifact } = z.object({ artifact: ArtifactSchema }).parse(await response.json())
    return { id: artifact.publicId, path: `/api/v1/artifacts/${artifact.publicId}` }
  }
  const invite = async (
    path: string,
    owner: string,
    target: HubInviteInput['target'],
    role: HubInviteInput['role'] = 'view',
    ttlSeconds = 300,
  ) => {
    const response = await send(`${path}/invitations`, 'POST', owner, { target, role, ttlSeconds })
    expect(response.status).toBe(201)
    const grant = z
      .object({ id: z.string(), url: z.url(), expiresAt: z.iso.datetime() })
      .parse(await response.json())
    expect(grant.url).toBe(`${origin}/invite/${grant.id}`)
    return grant.id
  }
  const accept = (id: string, cookie?: string) =>
    send(`/api/v1/invitations/${id}/accept`, 'POST', cookie, {})
  const link = async (path: string, owner: string) => {
    const created = await send(`${path}/share`, 'POST', owner, {
      role: 'edit',
      entry: { kind: 'artifact' },
    })
    expect(created.status).toBe(201)
    const { url } = z.object({ url: z.url() }).parse(await created.json())
    const redeemed = await send(url)
    expect(redeemed.status).toBe(302)
    const cookie = redeemed.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) throw new Error('普通链接未创建分享凭据')
    return { url, cookie }
  }
  return { send, login, publish, invite, accept, link }
}
