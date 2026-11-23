import { ARTIFACT_STORAGE_LIMITS, type SandboxToShellMessage } from '@akasha/protocol'
import { getApiBaseUrl } from '../config/runtime'
import type { SandboxBridgeHost } from './host'

type StorageRequest = Extract<SandboxToShellMessage, { type: 'storage.request' }>
const encoder = new TextEncoder()

export function createStorageRelay(artifactId: string, host: SandboxBridgeHost) {
  const lifetime = new AbortController()
  const pending = new Set<string>()
  const url = `${getApiBaseUrl()}/api/v1/artifacts/${encodeURIComponent(artifactId)}/storage`

  return {
    async handle({ requestId, operation }: StorageRequest) {
      if (lifetime.signal.aborted || pending.has(requestId)) return
      if (pending.size >= 16) {
        host.send({
          type: 'storage.response',
          requestId,
          ok: false,
          error: '制品存储并发请求已达上限',
        })
        return
      }
      pending.add(requestId)
      try {
        const body = JSON.stringify(operation)
        if (encoder.encode(body).length > ARTIFACT_STORAGE_LIMITS.valueBytes + 1024) {
          throw new Error('制品存储请求超过单值上限')
        }
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8_000)]),
        })
        const result = (await response.json()) as { value?: unknown; error?: { message?: string } }
        if (!response.ok)
          throw new Error(result.error?.message ?? `制品存储失败（HTTP ${response.status}）`)
        if (!lifetime.signal.aborted) {
          host.send({ type: 'storage.response', requestId, ok: true, value: result.value })
        }
      } catch (error) {
        if (!lifetime.signal.aborted) {
          host.send({
            type: 'storage.response',
            requestId,
            ok: false,
            error: error instanceof Error ? error.message : '制品存储请求失败',
          })
        }
      } finally {
        pending.delete(requestId)
      }
    },
    dispose() {
      lifetime.abort()
    },
  }
}
