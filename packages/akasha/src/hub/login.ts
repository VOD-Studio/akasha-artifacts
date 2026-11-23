import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { resolveAkashaHome } from '../daemon/state.js'

/** 保存在 `~/.akasha/hub-login.json` 的 Hub 登录凭据。 */
export interface HubLogin {
  origin: string
  /** CLI 访问令牌，以 Bearer 头发送。 */
  token: string
  expiresAt: string
}

/**
 * 校验并规范化 Hub 地址。
 *
 * @throws {Error} 不是 HTTPS origin（本机回环地址允许 HTTP），或带有凭据、路径、查询串、片段。
 */
export function parseHubOrigin(value: string): string {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Cloud Hub 地址须为 HTTPS origin；本机测试可以使用 HTTP 回环地址')
  }
  return url.origin
}

/** 读取 Hub 登录凭据；文件不存在、不完整或已过期时返回 `null`。 */
export function readHubLogin(homeDir: string): HubLogin | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(path.join(homeDir, 'hub-login.json'), 'utf8'),
    ) as Partial<HubLogin>
    if (
      typeof value.origin !== 'string' ||
      typeof value.token !== 'string' ||
      !value.token ||
      typeof value.expiresAt !== 'string' ||
      !(Date.parse(value.expiresAt) > Date.now())
    )
      return null
    return { origin: parseHubOrigin(value.origin), token: value.token, expiresAt: value.expiresAt }
  } catch {
    return null
  }
}

/**
 * 用 PKCE 流程登录 Hub：打印登录链接，等用户粘贴授权码，换取 CLI 令牌后写入 home 目录。
 *
 * @remarks 授权码只能兑换一次。凭据以 0600 权限原子写入 `hub-login.json`。
 * @throws {Error} 用户没有输入授权码、换取令牌失败，或 Hub 返回的凭据无效或已过期。
 */
export async function loginToHub(origin: string, homeOverride?: string): Promise<void> {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const url = new URL('/auth/cli', origin)
  url.searchParams.set('challenge', challenge)
  console.log(`在浏览器打开登录链接：\n${url}\n`)
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  let code: string
  try {
    code = (await prompt.question('粘贴 GitHub 登录后显示的一次性授权码：')).trim()
  } finally {
    prompt.close()
  }
  if (!code) throw new Error('未输入一次性授权码')
  const response = await fetch(new URL('/api/v1/auth/cli/token', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`换取 CLI 令牌失败（HTTP ${response.status}）`)
  const { token, expiresAt } = (await response.json()) as Partial<HubLogin>
  if (
    typeof token !== 'string' ||
    !token ||
    typeof expiresAt !== 'string' ||
    !(Date.parse(expiresAt) > Date.now())
  ) {
    throw new Error('Cloud Hub 返回了无效的登录凭据')
  }
  const home = resolveAkashaHome(homeOverride)
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const target = path.join(home, 'hub-login.json')
  const tmp = `${target}.${randomBytes(8).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ origin, token, expiresAt }), { mode: 0o600, flag: 'wx' })
    fs.renameSync(tmp, target)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
  console.log(`CLI 已登录 ${origin}，到期时间 ${expiresAt}`)
}

/** 向 Hub 登记本机目录对应的项目；`rootPath` 用目录路径的摘要，不上传真实路径。 */
export async function registerHubProject(
  origin: string,
  token: string,
  projectDir: string,
): Promise<string> {
  const root = path.resolve(projectDir)
  const fingerprint = createHash('sha256').update(root).digest('hex')
  const response = await fetch(new URL('/api/v1/projects', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      rootPath: `akasha://workspace/${fingerprint}`,
      name: path.basename(root) || 'workspace',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`无法登记 Cloud Hub 项目（HTTP ${response.status}）`)
  const { project } = (await response.json()) as { project: { id: string } }
  return project.id
}
