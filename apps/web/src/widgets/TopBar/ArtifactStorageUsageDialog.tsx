import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Skeleton } from '@akasha/ui/skeleton'
import { useArtifactStorageUsageQuery } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from './messages'

interface ArtifactStorageUsageDialogProps {
  artifactId: string
  /** 关闭后不再轮询或重读用量。 */
  onClose: () => void
}

/** 只展示该制品的共享与当前用户运行存储统计。 */
export function ArtifactStorageUsageDialog({
  artifactId,
  onClose,
}: ArtifactStorageUsageDialogProps) {
  const { t, number } = useMessages(messages)
  const usage = useArtifactStorageUsageQuery(artifactId)
  const { data, error, isPending } = usage
  const asBytes = (bytes: number) =>
    bytes < 1024
      ? `${number(bytes)} B`
      : `${number(bytes / 1024, { maximumFractionDigits: 1 })} KiB`
  const limit = data && asBytes(data.limitPerScopeBytes)
  const changeOpen = (open: boolean) => {
    if (!open) onClose()
  }
  return (
    <Modal
      open
      onOpenChange={changeOpen}
      title={t('存储用量')}
      description={t('仅统计运行数据，不含源码与版本。')}
      footer={<Button onClick={onClose}>{t('关闭')}</Button>}
    >
      {isPending && <Skeleton className="h-10 w-full" aria-label={t('正在加载用量')} />}
      {error && (
        <p role="alert" className="text-sm text-error">
          {getRequestErrorMessage(error)}
        </p>
      )}
      {data && (
        <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm tabular-nums">
          <dt>{t('共享')}</dt>
          <dd dir="ltr">
            {asBytes(data.sharedBytes)} / {limit}
          </dd>
          {data.privateBytes !== null && (
            <>
              <dt>{t('个人')}</dt>
              <dd dir="ltr">
                {asBytes(data.privateBytes)} / {limit}
              </dd>
            </>
          )}
        </dl>
      )}
    </Modal>
  )
}
