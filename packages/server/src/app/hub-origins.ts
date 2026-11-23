import { getDomain } from 'tldts'

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]']

function parseOrigin(value: string): URL {
  const url = new URL(value)
  if (
    url.origin !== value ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.includes(url.hostname)))
  ) {
    throw new Error('Hub 和沙盒须配置无路径的 HTTPS origin；仅本机联调可使用 HTTP')
  }
  return url
}

export function validateHubOrigins(origin: string, sandboxOrigin: string) {
  const hub = parseOrigin(origin)
  const sandbox = parseOrigin(sandboxOrigin)
  const loopback = LOOPBACK.includes(hub.hostname) && LOOPBACK.includes(sandbox.hostname)
  const hubDomain = getDomain(hub.hostname, { allowPrivateDomains: true })
  const sandboxDomain = getDomain(sandbox.hostname, { allowPrivateDomains: true })
  if (
    hub.origin === sandbox.origin ||
    (!loopback && (!hubDomain || !sandboxDomain || hubDomain === sandboxDomain))
  ) {
    throw new Error('Hub 与沙盒必须使用独立的注册域名；本机联调须使用不同 origin')
  }
  return { hubOrigin: hub.origin, sandboxOrigin: sandbox.origin }
}
