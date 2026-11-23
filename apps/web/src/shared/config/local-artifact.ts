import { PublicIdSchema } from '@akasha/protocol'
import { useEffect, useState } from 'react'
import { isCloudHub } from './runtime'

// 本机 Daemon 的固定端口段，与 `@akasha/akasha` 的默认值一致
const LOCAL_DAEMON_PORTS = [24321, 24322, 24323] as const

/**
 * 探测本机 Daemon 是否已有该制品或该版本。
 *
 * @returns 命中时返回本机工作台的页面地址；没有 Daemon 应答或都未命中时返回 `null`。
 *
 * @remarks 同时探测全部候选端口，取最先应答的结果，整体 900 毫秒超时。
 */
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

/**
 * 在 Hub 上打开制品时，先探测本机 Daemon；命中就跳转到本机工作台。
 *
 * @returns 是否仍在探测；探测期间调用方应暂缓启用 Hub 的实时连接。
 *
 * @remarks 只在 Hub 上对合法的 `publicId` 探测。跳转时带上当前的 `page` 与 `board` 定位。
 */
export function useLocalArtifactRedirect(publicId: string, version?: number): boolean {
  const shouldProbe = isCloudHub() && PublicIdSchema.safeParse(publicId).success
  const key = `${publicId}:${version ?? ''}`
  const [completed, setCompleted] = useState<string | null>(null)
  useEffect(() => {
    if (!shouldProbe) return
    const lifetime = new AbortController()
    void findLocalArtifact(publicId, version, lifetime.signal).then((url) => {
      if (lifetime.signal.aborted) return
      if (!url) {
        setCompleted(key)
        return
      }
      const destination = new URL(url)
      const current = new URLSearchParams(window.location.hash.slice(1))
      const locator = new URLSearchParams()
      for (const key of ['page', 'board']) {
        const value = current.get(key)
        if (value !== null) locator.set(key, value)
      }
      destination.hash = locator.toString()
      window.location.replace(destination)
    })
    return () => lifetime.abort()
  }, [publicId, version, shouldProbe, key])
  return shouldProbe && completed !== key
}
