import type { WithdrawnArtifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Empty } from '@akasha/ui/empty'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys, fetchWithdrawnArtifacts, restoreArtifact } from '@/entities/artifact'
import { AkashaMark } from '@/shared/brand'

interface WithdrawnArtifactsDialogProps {
  onOpenArtifact: (publicId: string) => void
  onClose: () => void
}

/** 显示撤下的元数据；恢复前不挂载这些制品的预览。 */
export function WithdrawnArtifactsDialog({
  onOpenArtifact,
  onClose,
}: WithdrawnArtifactsDialogProps) {
  const query = useQueryClient()
  const [selected, setSelected] = useState<WithdrawnArtifact | null>(null)
  const list = useQuery({
    queryKey: artifactKeys.withdrawn,
    queryFn: fetchWithdrawnArtifacts,
    retry: false,
  })
  const restore = useMutation({
    mutationFn: restoreArtifact,
    onSuccess: ({ artifact }) => {
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      void query.invalidateQueries({ queryKey: artifactKeys.favorites })
      toast.success('已恢复')
      onOpenArtifact(artifact.publicId)
      onClose()
    },
  })
  const items = selected ? undefined : list.data?.items
  const cancelRestore = () => {
    restore.reset()
    setSelected(null)
  }
  const restoreSelected = () => {
    if (selected) restore.mutate(selected.artifact.publicId)
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !restore.isPending) onClose()
      }}
      title={selected ? `恢复「${selected.artifact.title}」？` : '已撤下'}
      description={selected ? '旧分享链接不会恢复。' : undefined}
      footer={
        selected ? (
          <>
            <Button variant="ghost" disabled={restore.isPending} onClick={cancelRestore}>
              返回
            </Button>
            <Button loading={restore.isPending} onClick={restoreSelected}>
              恢复
            </Button>
          </>
        ) : undefined
      }
    >
      {list.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <AkashaMark size={16} loading className="text-ink" />
          加载中…
        </p>
      )}
      {list.error || restore.error ? (
        <p role="alert" className="text-sm text-error">
          {(list.error ?? restore.error)?.message}
        </p>
      ) : null}
      {items?.length === 0 && <Empty variant="plain" title="没有已撤下的作品" />}
      {items && items.length > 0 && (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.artifact.publicId}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0 text-sm">
                <p dir="auto" className="wrap-break-word font-medium">
                  {item.artifact.title}
                </p>
                <time dateTime={item.withdrawnAt} className="text-xs text-ink-muted">
                  {new Date(item.withdrawnAt).toLocaleString()}
                </time>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelected(item)}>
                恢复
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
