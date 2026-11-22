import {
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  SandboxToShellMessageSchema,
  type ShellToSandboxMessage,
} from '@akasha/protocol'

// 安全不变量：沙盒 iframe 严禁添加 allow-same-origin，始终保持不透明隔离源。
export const SANDBOX_IFRAME_SANDBOX_ATTR = 'allow-scripts' as const

export type ShellOutgoingPayload<T = ShellToSandboxMessage> = T extends unknown
  ? Omit<T, 'v' | 'nonce'>
  : never

export function createBridgeNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function buildSandboxIframeUrl(
  sandboxOrigin: string,
  nonce: string,
  shellOrigin: string,
): string {
  const cleanOrigin = sandboxOrigin.replace(/\/$/, '')
  const hash = new URLSearchParams({
    origin: shellOrigin,
    nonce,
  }).toString()
  return `${cleanOrigin}/#${hash}`
}

export interface PostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface SandboxBridgeHostOptions {
  sandboxOrigin: string
  nonce: string
  getIframeWindow: () => PostMessageTarget | null
  listenTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

// 外壳侧 Bridge 宿主：仅接受绑定 iframe 发回且通过 origin/source/zod/nonce 四重校验的消息；
// 在收到沙盒 ready 前缓存下发指令（render/state），保证首屏不丢帧。
export class SandboxBridgeHost {
  private readonly sandboxOrigin: string
  private readonly nonce: string
  private readonly getIframeWindow: () => PostMessageTarget | null
  private readonly listenTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  private readonly listeners = new Set<(msg: SandboxToShellMessage) => void>()
  private pendingQueue: ShellToSandboxMessage[] = []
  private ready = false
  private started = false

  constructor(options: SandboxBridgeHostOptions) {
    this.sandboxOrigin = new URL(options.sandboxOrigin).origin
    this.nonce = options.nonce
    this.getIframeWindow = options.getIframeWindow
    this.listenTarget = options.listenTarget ?? window
  }

  private readonly handleMessage = (event: MessageEvent) => {
    const iframeWin = this.getIframeWindow()
    if (!iframeWin) return
    if (event.source !== iframeWin) return

    // 不带 allow-same-origin 的 iframe 在真实浏览器中具有不透明源 "null"；
    // 同时允许精确匹配 sandboxOrigin 以兼容显式源测试，但一律拒绝任何其他第三方 origin。
    if (event.origin !== 'null' && event.origin !== this.sandboxOrigin) return

    const parsed = SandboxToShellMessageSchema.safeParse(event.data)
    if (!parsed.success) return
    if (parsed.data.nonce !== this.nonce) return

    if (parsed.data.type === 'ready') {
      this.ready = true
      this.flushPending()
    }

    for (const listener of this.listeners) {
      listener(parsed.data)
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.listenTarget.addEventListener('message', this.handleMessage as EventListener)
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.ready = false
    this.pendingQueue = []
    this.listenTarget.removeEventListener('message', this.handleMessage as EventListener)
  }

  isReady(): boolean {
    return this.ready
  }

  onMessage(listener: (msg: SandboxToShellMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  send(payload: ShellOutgoingPayload): void {
    const msg: ShellToSandboxMessage = {
      ...payload,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
    } as ShellToSandboxMessage

    if (!this.ready) {
      // 尚未 ready 时若出现新 render，仅保留最新 render 及其后 state，避免堆积过期帧
      if (msg.type === 'render') {
        this.pendingQueue = [msg]
      } else {
        this.pendingQueue.push(msg)
      }
      return
    }
    this.post(msg)
  }

  private flushPending(): void {
    if (this.pendingQueue.length === 0) return
    const queued = this.pendingQueue
    this.pendingQueue = []
    for (const msg of queued) {
      this.post(msg)
    }
  }

  private post(msg: ShellToSandboxMessage): void {
    const iframeWin = this.getIframeWindow()
    if (!iframeWin) return
    // 不带 allow-same-origin 的沙盒 iframe 具有不透明 origin，浏览器仅允许以 "*" 投递给不透明源；
    // 沙盒内不会收到任何凭据或 Cookie，且沙盒端会严格校验外壳 origin、source 与 nonce。
    iframeWin.postMessage(msg, '*')
  }
}
