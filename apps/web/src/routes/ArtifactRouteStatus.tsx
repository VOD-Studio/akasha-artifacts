import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { Skeleton } from '@akasha/ui/skeleton'
import { HubAccountButton } from '@/features/hub'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { LanguageMenu, useMessages } from '@/shared/i18n'
import { routeMessages } from './messages'

/** 解析本机直连与读取作品共用同一个等待状态。 */
export function OpeningArtifact() {
  const { t } = useMessages(routeMessages)
  return (
    <div className="flex h-dvh flex-col bg-canvas" role="status" aria-busy="true">
      <span className="sr-only">{t('正在打开…')}</span>
      <div className="flex min-h-13 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <Skeleton className="h-6 w-40 max-w-1/2" />
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <Skeleton className="h-2/3 w-full max-w-2xl rounded-lg" />
      </div>
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
  if (shareExpired) return '分享链接已过期'
  if (error instanceof ApiError) {
    if (error.status === 401) return '请登录后打开'
    if (error.status === 403) return '没有查看权限'
    if (error.status === 404 || error.status === 410) return '作品不可用'
  }
  return '无法打开作品'
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
  const { t } = useMessages(routeMessages)
  const description = shareExpired ? t('请向分享者索取新链接。') : undefined
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-canvas p-6">
      <Alert
        className="w-full max-w-md"
        tone="danger"
        title={t(issue)}
        description={
          issue === '无法打开作品' && error ? getRequestErrorMessage(error) : description
        }
      />
      <div className="flex flex-wrap items-center justify-center gap-2">
        <LanguageMenu />
        <HubAccountButton />
        <Button variant="outline" onClick={onBack}>
          {t('返回作品库')}
        </Button>
        {onRetry && (
          <Button loading={retrying} onClick={onRetry}>
            {t('重试')}
          </Button>
        )}
      </div>
    </main>
  )
}
