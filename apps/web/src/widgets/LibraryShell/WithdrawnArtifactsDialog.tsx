import type { WithdrawnArtifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys } from '../../entities/artifact/queries'
import { fetchWithdrawnArtifacts, restoreArtifact } from '../../shared/api/client'

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
      toast.success('已恢复制品；旧的签名分享仍然无效')
      onOpenArtifact(artifact.publicId)
      onClose()
    },
  })
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !restore.isPending) onClose()
      }}
      title={selected ? `恢复「${selected.artifact.title}」？` : '已撤下的制品'}
      description={
        selected
          ? '原制品会重新出现在库中，普通书签、版本和讨论恢复可用。撤下前签发的分享链接仍然无效。'
          : '只有维护者可以查看和恢复。这里不显示撤下制品的源码或预览。'
      }
      footer={
        selected ? (
          <>
            <Button
              variant="ghost"
              disabled={restore.isPending}
              onClick={() => {
                restore.reset()
                setSelected(null)
              }}
            >
              返回列表
            </Button>
            <Button
              loading={restore.isPending}
              disabled={restore.isPending}
              onClick={() => restore.mutate(selected.artifact.publicId)}
            >
              确认恢复
            </Button>
          </>
        ) : undefined
      }
    >
      {list.isPending ? (
        <p role="status" className="text-sm text-ink-muted">
          正在读取已撤下制品…
        </p>
      ) : null}
      {list.error || restore.error ? (
        <p role="alert" className="text-sm text-error">
          {(list.error ?? restore.error)?.message}
        </p>
      ) : null}
      {!selected && list.data ? (
        list.data.items.length ? (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto">
            {list.data.items.map((item) => (
              <li
                key={item.artifact.publicId}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0 text-sm">
                  <p className="break-words font-medium">{item.artifact.title}</p>
                  <p className="break-all text-xs text-ink-muted">
                    {item.artifact.slug} · v{item.artifact.headVersion}
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
        ) : (
          <p className="text-sm text-ink-muted">没有已撤下的制品。</p>
        )
      ) : null}
    </Modal>
  )
}
