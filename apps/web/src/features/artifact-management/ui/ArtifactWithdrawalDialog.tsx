import type { Artifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { artifactKeys, withdrawArtifact } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

interface ArtifactWithdrawalDialogProps {
  artifact: Artifact
  onClose: () => void
  onWithdrawn: () => void
}

/** 只有服务端确认撤下后才离开工作区。 */
export function ArtifactWithdrawalDialog({
  artifact,
  onClose,
  onWithdrawn,
}: ArtifactWithdrawalDialogProps) {
  const { t } = useMessages(messages)
  const query = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => withdrawArtifact(artifact.publicId),
    onSuccess: () => {
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      void query.invalidateQueries({ queryKey: artifactKeys.favorites })
      toast.success(t('已撤下'))
      onWithdrawn()
      onClose()
    },
  })
  const changeOpen = (open: boolean) => {
    if (!open && !mutation.isPending) onClose()
  }
  const withdraw = () => mutation.mutate()
  return (
    <Modal
      open
      onOpenChange={changeOpen}
      title={t('撤下「{title}」？', { title: artifact.title })}
      description={t('可在作品库恢复。旧分享链接永久失效。')}
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="destructive" loading={mutation.isPending} onClick={withdraw}>
            {t('撤下')}
          </Button>
        </>
      }
    >
      {mutation.error ? (
        <p role="alert" className="mt-2 text-sm text-error">
          {getRequestErrorMessage(mutation.error)}
        </p>
      ) : null}
    </Modal>
  )
}
