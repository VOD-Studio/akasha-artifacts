import {
  PROTOCOL_VERSION,
  type SandboxToShellMessage,
  type ShellToSandboxMessage,
  ShellToSandboxMessageSchema,
} from '@akasha/protocol'

export type SandboxOutgoingPayload<T = SandboxToShellMessage> = T extends unknown
  ? Omit<T, 'v' | 'nonce'>
  : never

export interface SandboxHashParams {
  origin: string
  nonce: string
}

// 从 URL hash（#origin=...&nonce=...）读取外壳 origin 与会话 nonce，避免经 query 泄漏到日志或 Referer。
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
  expectedOrigin: string
  nonce: string
  hostWindow?: PostMessageTarget
  listenTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
}

// 沙盒侧 Bridge 客户端：严格校验消息来源 origin、zod 结构与 nonce，拒收一切伪造或跨源指令。
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

  send(payload: SandboxOutgoingPayload): void {
    const message: SandboxToShellMessage = {
      ...payload,
      v: PROTOCOL_VERSION,
      nonce: this.nonce,
    } as SandboxToShellMessage
    this.hostWindow.postMessage(message, this.expectedOrigin)
  }
}
