import { useEffect, useRef, useState } from 'react'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
} from '@/shared/bridge/host'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

interface SystemPreviewProps {
  source: string
  sandboxOrigin: string
  /** 只有当前沙盒确实渲染才允许保存；构建后的运行时错误也会撤销许可。 */
  onRendered?: (ready: boolean) => void
}

/** 每次构建由独立桥接会话展示；不提供存储、反馈或任何带身份的宿主操作。 */
export function SystemPreview({ source, sandboxOrigin, onRendered }: SystemPreviewProps) {
  const { t } = useMessages(messages)
  const frame = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    const nonce = createBridgeNonce()
    setLoading(true)
    setFailure(null)
    onRendered?.(false)
    const host = new SandboxBridgeHost({
      nonce,
      sandboxOrigin,
      getIframeWindow: () => frame.current?.contentWindow ?? null,
    })
    let failed = false
    const fail = (message: string) => {
      failed = true
      setLoading(false)
      setFailure(message)
      onRendered?.(false)
    }
    const timer = window.setTimeout(() => fail(''), 15000)
    const off = host.onMessage((message) => {
      if (message.type === 'error') {
        window.clearTimeout(timer)
        fail(message.message)
      } else if (
        message.type === 'rendered' &&
        message.version === 1 &&
        host.isReady() &&
        !failed
      ) {
        window.clearTimeout(timer)
        setLoading(false)
        onRendered?.(true)
      } else if (message.type === 'storage.request') {
        host.send({
          type: 'storage.response',
          requestId: message.requestId,
          ok: false,
          error: 'Storage unavailable',
        })
      }
    })
    host.start()
    host.send({ type: 'render', version: 1, artifactType: 'react', source, state: {} })
    // 监听器就绪后再导航，否则缓存命中的沙盒可能先于 effect 发出 ready。
    if (frame.current)
      frame.current.src = buildSandboxIframeUrl(sandboxOrigin, nonce, window.location.origin)
    return () => {
      window.clearTimeout(timer)
      off()
      host.stop()
    }
  }, [sandboxOrigin, source, onRendered])
  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t('隔离预览')}</h3>
      {loading && <p role="status">{t('正在加载预览')}</p>}
      {failure !== null && (
        <p role="alert">
          {t('无法加载预览')} <bdi>{failure}</bdi>
        </p>
      )}
      <iframe
        ref={frame}
        title={t('隔离预览')}
        sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
        referrerPolicy="no-referrer"
        className="h-64 w-full rounded-8 border border-border"
      />
    </section>
  )
}
