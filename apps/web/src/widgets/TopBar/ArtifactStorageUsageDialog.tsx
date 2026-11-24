import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Skeleton } from '@akasha/ui/skeleton'
import { useArtifactStorageUsageQuery } from '../../entities/artifact/queries'

interface ArtifactStorageUsageDialogProps {
  artifactId: string
  /** 关闭后不再轮询或重读用量。 */
  onClose: () => void
}

function asBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Number((bytes / 1024).toFixed(1))} KiB`
}

/** 只展示该制品的共享与当前用户运行存储统计。 */
export function ArtifactStorageUsageDialog({
  artifactId,
  onClose,
}: ArtifactStorageUsageDialogProps) {
  const usage = useArtifactStorageUsageQuery(artifactId)
  const { data, error, isPending } = usage
  const limit = data && asBytes(data.limitPerScopeBytes)
  const changeOpen = (open: boolean) => {
    if (!open) onClose()
  }
  return (
    <Modal
      open
      onOpenChange={changeOpen}
      title="存储用量"
      description="仅统计运行数据，不含源码与版本。"
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {isPending && <Skeleton className="h-10 w-full" aria-label="正在加载用量" />}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error.message}
        </p>
      )}
      {data && (
        <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm tabular-nums">
          <dt>共享</dt>
          <dd>
            {asBytes(data.sharedBytes)} / {limit}
          </dd>
          {data.privateBytes !== null && (
            <>
              <dt>个人</dt>
              <dd>
                {asBytes(data.privateBytes)} / {limit}
              </dd>
            </>
          )}
        </dl>
      )}
    </Modal>
  )
}
