import type { Artifact } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { type ChangeEventHandler, type FormEventHandler, useId, useState } from 'react'
import { useRenameArtifactMutation } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

interface RenameArtifactDialogProps {
  artifact: Artifact
  onClose: () => void
}

/** 修改展示名；保存不改变作品的历史版本和链接。 */
export function RenameArtifactDialog({ artifact, onClose }: RenameArtifactDialogProps) {
  const { t } = useMessages(messages)
  const formId = useId()
  const [name, setName] = useState(artifact.title)
  const rename = useRenameArtifactMutation(artifact.publicId)
  const title = name.trim()
  const canSave = title.length > 0 && title !== artifact.title

  const changeName: ChangeEventHandler<HTMLInputElement> = (event) => {
    setName(event.currentTarget.value)
  }
  const save: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    if (canSave && !rename.isPending) rename.mutate(title, { onSuccess: onClose })
  }
  const changeOpen = (open: boolean) => {
    if (!open && !rename.isPending) onClose()
  }

  return (
    <Modal
      open
      onOpenChange={changeOpen}
      title={t('重命名')}
      footer={
        <>
          <Button variant="ghost" disabled={rename.isPending} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button type="submit" form={formId} loading={rename.isPending} disabled={!canSave}>
            {t('保存')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={save}>
        <Field
          label={t('名称')}
          error={rename.error ? getRequestErrorMessage(rename.error) : undefined}
        >
          <Input
            dir="auto"
            value={name}
            maxLength={240}
            readOnly={rename.isPending}
            onChange={changeName}
          />
        </Field>
      </form>
    </Modal>
  )
}
