import type { Artifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { artifactKeys } from '../../entities/artifact/queries'
import { withdrawArtifact } from '../../shared/api/client'

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
      toast.success('已撤下制品，可从库中的「已撤下」恢复')
      onWithdrawn()
      onClose()
    },
  })
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
      title={`撤下「${artifact.title}」？`}
      description="库、搜索、收藏与原有书签将无法打开这份制品。已发放的签名分享永久撤销；版本、反馈和源文件不会删除。"
      footer={
        <>
          <Button variant="ghost" disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            loading={mutation.isPending}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            确认撤下
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        维护者可从制品库恢复。恢复后原书签重新可用，旧签名不会重新生效。
      </p>
      {mutation.error ? (
        <p role="alert" className="mt-2 text-sm text-error">
          {mutation.error.message}
        </p>
      ) : null}
    </Modal>
  )
}
