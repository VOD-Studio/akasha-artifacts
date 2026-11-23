declare global {
  interface Window {
    __AKASHA_CONFIG__?: {
      sandboxOrigin?: string
      apiBaseUrl?: string
      hub?: boolean
    }
  }
}

/** 当前页面是否由 Hub 托管；Daemon 注入的配置里带 `hub` 标记。 */
export function isCloudHub(): boolean {
  return typeof window !== 'undefined' && window.__AKASHA_CONFIG__?.hub === true
}

/** API 的根地址；空串表示与页面同源。 */
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.__AKASHA_CONFIG__?.apiBaseUrl) {
    return window.__AKASHA_CONFIG__.apiBaseUrl.replace(/\/$/, '')
  }
  return ''
}

/** WebSocket 地址：与 API 同源，协议按页面换成 `ws:` 或 `wss:`。 */
export function getWsUrl(): string {
  if (typeof window === 'undefined') {
    return 'ws://127.0.0.1:24321/api/v1/ws'
  }
  const base = getApiBaseUrl()
  if (base) {
    const parsed = new URL(base, window.location.origin)
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${parsed.origin}/api/v1/ws`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/api/v1/ws`
}

/**
 * 沙盒的 origin：优先用 Daemon 注入的配置，否则用页面主机名加 Daemon 上报的 `sandboxPort`。
 */
export function resolveSandboxOrigin(sandboxPort?: number): string {
  if (typeof window !== 'undefined' && window.__AKASHA_CONFIG__?.sandboxOrigin) {
    return window.__AKASHA_CONFIG__.sandboxOrigin.replace(/\/$/, '')
  }
  const host = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1'
  const port = sandboxPort ?? 24331
  return `http://${host}:${port}`
}
