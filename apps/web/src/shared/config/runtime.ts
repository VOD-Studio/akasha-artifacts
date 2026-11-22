declare global {
  interface Window {
    __AKASHA_CONFIG__?: {
      sandboxOrigin?: string
      apiBaseUrl?: string
    }
  }
}

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.__AKASHA_CONFIG__?.apiBaseUrl) {
    return window.__AKASHA_CONFIG__.apiBaseUrl.replace(/\/$/, '')
  }
  return ''
}

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

// 优先读取 Daemon 注入的独立沙盒 origin，开发环境回退到 Daemon 上报的 sandboxPort。
export function resolveSandboxOrigin(sandboxPort?: number): string {
  if (typeof window !== 'undefined' && window.__AKASHA_CONFIG__?.sandboxOrigin) {
    return window.__AKASHA_CONFIG__.sandboxOrigin.replace(/\/$/, '')
  }
  const host = typeof window !== 'undefined' ? window.location.hostname || '127.0.0.1' : '127.0.0.1'
  const port = sandboxPort ?? 24331
  return `http://${host}:${port}`
}
