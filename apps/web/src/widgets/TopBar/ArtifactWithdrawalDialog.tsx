import type { Artifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { artifactKeys, withdrawArtifact } from '@/entities/artifact'

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
  const query = useQueryClient()
  const mutation = useMutation({
    mutationFn: () => withdrawArtifact(artifact.publicId),
    onSuccess: () => {
      void query.invalidateQueries({ queryKey: artifactKeys.all })
      void query.invalidateQueries({ queryKey: artifactKeys.favorites })
      toast.success('已撤下')
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
      title={`撤下「${artifact.title}」？`}
      description="可在作品库恢复。旧分享链接永久失效。"
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button variant="destructive" loading={mutation.isPending} onClick={withdraw}>
            撤下
          </Button>
        </>
      }
    >
      {mutation.error ? (
        <p role="alert" className="mt-2 text-sm text-error">
          {mutation.error.message}
        </p>
      ) : null}
    </Modal>
  )
}
