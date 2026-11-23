import {
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  SandboxToShellMessageSchema,
  type ShellToSandboxMessage,
} from '@akasha/protocol'

/**
 * 沙盒 iframe 的 `sandbox` 属性：只允许脚本。
 *
 * @remarks 严禁加 `allow-same-origin`，使沙盒始终保持不透明隔离源。
 */
export const SANDBOX_IFRAME_SANDBOX_ATTR = 'allow-scripts' as const

/** 发往沙盒的消息载荷：信封字段 `v` 与 `nonce` 由宿主补齐。 */
export type ShellOutgoingPayload<T = ShellToSandboxMessage> = T extends unknown
  ? Omit<T, 'v' | 'nonce'>
  : never

/** 为一个沙盒 iframe 会话生成 32 位十六进制随机串。 */
export function createBridgeNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 拼出沙盒页面地址：外壳 origin 与会话 nonce 放在 hash 里传给沙盒。 */
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

/**
 * 外壳侧的 Bridge 宿主。
 *
 * @remarks 只接受绑定 iframe 发回、并通过来源窗口、origin、结构与 nonce 校验的消息。
 * 收到沙盒的 `ready` 之前，下发的指令先缓存，收到后一次性补发。
 */
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

  /** 沙盒是否已发出 `ready`。 */
  isReady(): boolean {
    return this.ready
  }

  onMessage(listener: (msg: SandboxToShellMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 给载荷补上 `v` 与 `nonce` 后发往沙盒；沙盒未就绪时先缓存。 */
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
