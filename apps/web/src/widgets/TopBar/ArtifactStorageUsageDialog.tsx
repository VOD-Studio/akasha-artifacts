import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
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
  const limit = usage.data ? asBytes(usage.data.limitPerScopeBytes) : ''
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="制品存储用量"
      description="统计运行存储，不包括源码、版本历史或其他用户的数据。"
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {usage.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          正在读取用量…
        </p>
      ) : usage.isError ? (
        <p role="alert" className="text-sm text-error">
          {usage.error.message}
        </p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-2 text-sm tabular-nums">
          <dt>共享运行存储</dt>
          <dd>
            {asBytes(usage.data.sharedBytes)} / {limit}
          </dd>
          {usage.data.privateBytes !== null ? (
            <>
              <dt>个人运行存储</dt>
              <dd>
                {asBytes(usage.data.privateBytes)} / {limit}
              </dd>
            </>
          ) : null}
        </dl>
      )}
    </Modal>
  )
}
