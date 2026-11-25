import { Button } from '@akasha/ui/button'
import { Modal } from '@akasha/ui/dialog'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { ShieldCheck } from 'lucide-react'
import { type ChangeEventHandler, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 库页的管理入口：按输入的作品 ID 打开策略页，不要求作品列表或内容读取权。 */
export function HubSharingPolicyLauncher() {
  const { t } = useMessages(messages)
  const [open, setOpen] = useState(false)
  const [artifactId, setArtifactId] = useState('')
  const trimmed = artifactId.trim()
  const editArtifactId: ChangeEventHandler<HTMLInputElement> = (event) =>
    setArtifactId(event.target.value)
  const close = () => {
    setOpen(false)
    setArtifactId('')
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ShieldCheck size={14} />}
        onClick={() => setOpen(true)}
      >
        {t('分享策略')}
      </Button>
      <Modal
        open={open}
        onOpenChange={(visible) => {
          if (!visible) close()
        }}
        title={t('打开作品分享策略')}
        description={t('按作品 ID 打开，不需要作品读取权限')}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              {t('取消')}
            </Button>
            {trimmed ? (
              <Button asChild>
                <a href={`/admin/sharing/${encodeURIComponent(trimmed)}`}>{t('打开')}</a>
              </Button>
            ) : (
              <Button disabled>{t('打开')}</Button>
            )}
          </>
        }
      >
        <Field label={t('作品 ID')} hint={t('作品页地址 /a/<作品 ID> 中的 ID')}>
          <Input
            value={artifactId}
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
            onChange={editArtifactId}
          />
        </Field>
      </Modal>
    </>
  )
}
