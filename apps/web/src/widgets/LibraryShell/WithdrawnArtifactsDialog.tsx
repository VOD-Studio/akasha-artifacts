import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Empty } from '@akasha/ui/empty'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { artifactKeys, fetchWithdrawnArtifacts, restoreArtifact } from '@/entities/artifact'
import { ApiError, getRequestErrorMessage } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'
import { useMessages } from '@/shared/i18n'
import { messages } from './messages'

interface WithdrawnArtifactsDialogProps {
  onOpenArtifact: (publicId: string) => void
  onClose: () => void
}

/** 显示撤下的元数据；恢复前不挂载这些制品的预览。 */
export function WithdrawnArtifactsDialog({
  onOpenArtifact,
  onClose,
}: WithdrawnArtifactsDialogProps) {
  const { t, date } = useMessages(messages)
  const query = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
      toast.success(t('已恢复'))
      onOpenArtifact(artifact.publicId)
      onClose()
    },
    onError: (error) => {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        void query.invalidateQueries({ queryKey: artifactKeys.withdrawn })
      }
    },
  })
  const blocked =
    restore.error instanceof ApiError && [401, 403, 404].includes(restore.error.status)
  const selected = list.isSuccess
    ? list.data.items.find((item) => item.artifact.publicId === selectedId)
    : undefined
  const items = !selected && list.isSuccess ? list.data.items : undefined
  const cancelRestore = () => {
    restore.reset()
    setSelectedId(null)
  }
  const restoreSelected = () => {
    if (selected && !blocked) restore.mutate(selected.artifact.publicId)
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !restore.isPending) onClose()
      }}
      title={selected ? t('恢复「{title}」？', { title: selected.artifact.title }) : t('已撤下')}
      description={selected ? t('旧分享链接不会恢复。') : undefined}
      footer={
        selected ? (
          <>
            <Button variant="ghost" disabled={restore.isPending} onClick={cancelRestore}>
              {t('返回')}
            </Button>
            {!blocked && (
              <Button loading={restore.isPending} onClick={restoreSelected}>
                {t('恢复')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {list.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
          <AkashaMark size={16} loading className="text-ink" />
          {t('加载中…')}
        </p>
      )}
      {list.error || restore.error ? (
        <p role="alert" className="text-sm text-error">
          {getRequestErrorMessage(list.error ?? restore.error)}
        </p>
      ) : null}
      {items?.length === 0 && <Empty variant="plain" title={t('没有已撤下的作品')} />}
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
                  <bdi>
                    {date(new Date(item.withdrawnAt), { dateStyle: 'medium', timeStyle: 'short' })}
                  </bdi>
                </time>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedId(item.artifact.publicId)}
              >
                {t('恢复')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
