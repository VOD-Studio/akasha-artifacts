import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { HubAccountButton } from '@/features/hub'
import { ApiError } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'

/** 解析本机直连与读取作品共用同一个等待状态。 */
export function OpeningArtifact() {
  return (
    <div
      className="flex h-dvh flex-col items-center justify-center gap-3 bg-canvas text-sm text-ink-muted"
      role="status"
    >
      <AkashaMark size={28} loading className="text-ink" />
      <span>正在打开…</span>
    </div>
  )
}

interface UnavailableArtifactProps {
  error: Error | null
  shareExpired: boolean
  retrying: boolean
  onRetry?: () => void
  onBack: () => void
}

function getOpenIssue(error: Error | null, shareExpired: boolean) {
  if (shareExpired) return { title: '分享链接已过期', description: '请向分享者索取新链接。' }
  if (error instanceof ApiError) {
    if (error.status === 401) return { title: '请登录后打开' }
    if (error.status === 403) return { title: '没有查看权限' }
    if (error.status === 404 || error.status === 410) return { title: '作品不可用' }
  }
  return { title: '无法打开作品', description: error?.message }
}

/** 拒绝访问时不渲染缓存的画布；只有可重试的读取失败才提供重试。 */
export function UnavailableArtifact({
  error,
  shareExpired,
  retrying,
  onRetry,
  onBack,
}: UnavailableArtifactProps) {
  const issue = getOpenIssue(error, shareExpired)
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6">
      <Alert
        className="w-full max-w-md"
        tone="danger"
        title={issue.title}
        description={issue.description}
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <HubAccountButton />
        <Button variant="outline" onClick={onBack}>
          返回作品库
        </Button>
        {onRetry && (
          <Button loading={retrying} onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
    </main>
  )
}
