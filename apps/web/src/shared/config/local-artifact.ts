import { PublicIdSchema } from '@akasha/protocol'
import { useEffect, useState } from 'react'
import { isCloudHub } from './runtime'

const LOCAL_DAEMON_PORTS = [24321, 24322, 24323] as const

export async function findLocalArtifact(
  publicId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<string | null> {
  const cancel = new AbortController()
  const signals = [cancel.signal, AbortSignal.timeout(900)]
  if (signal) signals.push(signal)
  const requestSignal = AbortSignal.any(signals)
  const artifactPath = `/a/${encodeURIComponent(publicId)}${version === undefined ? '' : `/v/${version}`}`
  try {
    return await Promise.any(
      LOCAL_DAEMON_PORTS.map(async (port) => {
        const origin = `http://127.0.0.1:${port}`
        const probe = new URL(`/api/v1/local-artifact/${encodeURIComponent(publicId)}`, origin)
        if (version !== undefined) probe.searchParams.set('version', String(version))
        const response = await fetch(probe, {
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: requestSignal,
        })
        if (response.status !== 204) throw new Error('本机未登记此制品版本')
        return origin + artifactPath
      }),
    )
  } catch {
    return null
  } finally {
    cancel.abort()
  }
}

// 先完成本机探测再启用 Hub 实时连接；本机命中时用本机工作台的同源 API 和 WebSocket。
export function useLocalArtifactRedirect(publicId: string, version?: number): boolean {
  const shouldProbe = isCloudHub() && PublicIdSchema.safeParse(publicId).success
  const key = `${publicId}:${version ?? ''}`
  const [completed, setCompleted] = useState<string | null>(null)
  useEffect(() => {
    if (!shouldProbe) return
    const lifetime = new AbortController()
    void findLocalArtifact(publicId, version, lifetime.signal).then((url) => {
      if (lifetime.signal.aborted) return
      if (url) window.location.replace(url)
      else setCompleted(key)
    })
    return () => lifetime.abort()
  }, [publicId, version, shouldProbe, key])
  return shouldProbe && completed !== key
}
