import { ArtifactStorageOperationSchema, type StorageScope } from '@akasha/protocol'
import type { SandboxBridgeClient } from '../bridge/client'

// scope 省略时为 private
interface StorageOptions {
  scope?: StorageScope
}

interface SandboxStorage {
  get(key: string, options?: StorageOptions): Promise<unknown>
  set(key: string, value: unknown, options?: StorageOptions): Promise<void>
  delete(key: string, options?: StorageOptions): Promise<boolean>
  list(options?: StorageOptions & { prefix?: string }): Promise<string[]>
}

declare global {
  interface Window {
    akasha: { storage: SandboxStorage }
  }
}

interface PendingRequest {
  timer: number
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * 在沙盒内安装 `window.akasha.storage`；所有操作都经 Bridge 交给外壳代办，沙盒自己不联网。
 *
 * @remarks 未接入 Bridge 时调用会直接报错。同时最多 16 个未完成的请求，单个请求 10 秒超时。
 */
export function installSandboxStorage(bridge: SandboxBridgeClient | null): void {
  const pending = new Map<string, PendingRequest>()
  bridge?.onMessage((message) => {
    if (message.type !== 'storage.response') return
    const request = pending.get(message.requestId)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.requestId)
    if (message.ok) request.resolve(message.value)
    else request.reject(new Error(message.error ?? '制品存储请求失败'))
  })

  async function send(operation: unknown): Promise<unknown> {
    if (!bridge) throw new Error('请在 Akasha 画布内使用制品存储')
    if (pending.size >= 16) throw new Error('制品存储并发请求已达上限')
    const checked = ArtifactStorageOperationSchema.safeParse(operation)
    if (!checked.success) throw new Error('制品存储参数无效')
    const requestId = crypto.randomUUID()
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const timer = window.setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('制品存储请求超时'))
    }, 10_000)
    pending.set(requestId, { resolve, reject, timer })
    try {
      bridge.send({ type: 'storage.request', requestId, operation: checked.data })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(requestId)
      reject(error)
    }
    return promise
  }

  const storage: SandboxStorage = {
    get: (key, options) => send({ action: 'get', key, scope: options?.scope ?? 'private' }),
    async set(key, value, options) {
      await send({ action: 'set', key, value, scope: options?.scope ?? 'private' })
    },
    async delete(key, options) {
      return (await send({ action: 'delete', key, scope: options?.scope ?? 'private' })) === true
    },
    async list(options) {
      const result = await send({
        action: 'list',
        scope: options?.scope ?? 'private',
        prefix: options?.prefix,
      })
      if (!Array.isArray(result) || result.some((key) => typeof key !== 'string')) {
        throw new Error('制品存储键列表格式无效')
      }
      return result
    },
  }
  Object.defineProperty(window, 'akasha', {
    value: Object.freeze({ storage: Object.freeze(storage) }),
  })
}
