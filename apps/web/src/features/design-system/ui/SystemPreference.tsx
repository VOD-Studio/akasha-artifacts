import { Checkbox } from '@akasha/ui/checkbox'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMessages } from '@/shared/i18n'
import { updateDefaultPreference } from '../api/catalog'
import { messages } from '../messages'

/** 持久偏好随成员跨项目生效，不作为本次起稿的临时选择。 */
export function SystemPreference({
  projectId,
  inheritDefault,
}: {
  projectId: string
  inheritDefault: boolean
}) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const save = useMutation({
    mutationFn: (value: boolean) => updateDefaultPreference(projectId, value),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['system-catalog'] }),
  })
  return (
    <div>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={inheritDefault}
          disabled={save.isPending}
          onCheckedChange={(checked) => save.mutate(checked === true)}
        />
        {t('继承团队默认')}
      </label>
      {save.isError && <p role="alert">{t('未能保存个人设置')}</p>}
    </div>
  )
}
