import {
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  type ShellToSandboxMessage,
  ShellToSandboxMessageSchema,
} from '@akasha/protocol'

/** 发往外壳的消息载荷：信封字段 `v` 与 `nonce` 由客户端补齐。 */
export type SandboxOutgoingPayload<T = SandboxToShellMessage> = T extends unknown
  ? Omit<T, 'v' | 'nonce'>
  : never

export interface SandboxHashParams {
  origin: string
  nonce: string
}

/**
 * 从 URL hash（`#origin=...&nonce=...`）读取外壳 origin 与会话 nonce。
 *
 * @remarks 放在 hash 而不是 query 里，避免经请求行泄漏到日志或 Referer。
 * @returns 缺少任一参数，或 origin 不是 HTTP(S) 地址时返回 `null`。
 */
export function parseSandboxHash(hash: string): SandboxHashParams | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const origin = params.get('origin')?.trim()
  const nonce = params.get('nonce')?.trim()
  if (!origin || !nonce) return null
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return { origin: parsed.origin, nonce }
  } catch {
    return null
  }
}

export interface PostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

export interface SandboxBridgeClientOptions {
  // 只接受这个 origin 发来的消息，也只向它发送
  expectedOrigin: string
  nonce: string
  // 发送目标，缺省为父窗口
  hostWindow?: PostMessageTarget
  // 监听 message 事件的目标，缺省为当前窗口
  listenTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

/**
 * 沙盒侧的 Bridge 客户端。
 *
 * @remarks 收到的消息依次校验来源 origin、发送窗口、结构与 nonce，任何一步不符都静默丢弃。
 */
export class SandboxBridgeClient {
  private readonly listeners = new Set<(msg: ShellToSandboxMessage) => void>()
  private readonly expectedOrigin: string
  private readonly nonce: string
  private readonly hostWindow: PostMessageTarget
  private readonly listenTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>
  private started = false

  constructor(options: SandboxBridgeClientOptions) {
    this.expectedOrigin = options.expectedOrigin
    this.nonce = options.nonce
    this.hostWindow = options.hostWindow ?? window.parent
    this.listenTarget = options.listenTarget ?? window
  }

  private readonly handleMessage = (event: MessageEvent) => {
    if (event.origin !== this.expectedOrigin) return
    if (this.hostWindow && event.source && event.source !== this.hostWindow) return

    const parsed = ShellToSandboxMessageSchema.safeParse(event.data)
    if (!parsed.success) return
    if (parsed.data.nonce !== this.nonce) return

    for (const listener of this.listeners) {
      listener(parsed.data)
    }
  }

  /** 开始监听，并向外壳发出 `ready`。 */
  start(): void {
    if (this.started) return
    this.started = true
    this.listenTarget.addEventListener('message', this.handleMessage as EventListener)
    this.send({ type: 'ready' })
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.listenTarget.removeEventListener('message', this.handleMessage as EventListener)
  }

  onMessage(listener: (msg: ShellToSandboxMessage) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 给载荷补上 `v` 与 `nonce` 后发往外壳。 */
  send(payload: SandboxOutgoingPayload): void {
    const message: SandboxToShellMessage = {
      ...payload,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
    } as SandboxToShellMessage
    this.hostWindow.postMessage(message, this.expectedOrigin)
  }
}
