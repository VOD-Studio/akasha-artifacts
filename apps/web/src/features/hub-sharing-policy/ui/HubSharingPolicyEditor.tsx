import type { HubAdminSharingPolicy } from '@akasha/protocol'
import { Field, FieldSet } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Switch } from '@akasha/ui/switch'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import type { PolicyPatch } from '../lib/policy'
import { optionToOverride, overrideToOption, parsePolicyOption } from '../lib/policy'
import { messages } from '../messages'

interface HubSharingPolicyEditorProps {
  policy: HubAdminSharingPolicy
  /** 写请求进行中：开关与例外选择暂不接受新的修改。 */
  saving: boolean
  /** 最近一次保存失败；展示原因并已回滚到服务端值。 */
  error: Error | null
  onPatch: (patch: PolicyPatch) => void
}

interface PolicyOverrideFieldProps {
  label: string
  value: boolean | null
  /** 继承时展示的当前默认值。 */
  fallback: boolean
  disabled?: boolean
  onChange: (value: boolean | null) => void
}

/** 单个例外项：三态选择，继承时提示当前生效的默认值。 */
function PolicyOverrideField({
  label,
  value,
  fallback,
  disabled,
  onChange,
}: PolicyOverrideFieldProps) {
  const { t } = useMessages(messages)
  const select = (option: string) => onChange(optionToOverride(parsePolicyOption(option)))
  return (
    <Field
      label={label}
      hint={
        value === null
          ? t('当前默认：{value}', { value: fallback ? t('允许') : t('禁止') })
          : undefined
      }
    >
      <Select value={overrideToOption(value)} disabled={disabled} onValueChange={select}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">{t('继承默认')}</SelectItem>
          <SelectItem value="allow">{t('允许')}</SelectItem>
          <SelectItem value="deny">{t('禁止')}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}

/** Hub 默认值与单作品例外的两组设置；每次修改立即提交一组。 */
export function HubSharingPolicyEditor({
  policy,
  saving,
  error,
  onPatch,
}: HubSharingPolicyEditorProps) {
  const { t } = useMessages(messages)
  const setExternalLinks = (checked: boolean) =>
    onPatch({ defaults: { ...policy.defaults, externalLinks: checked } })
  const setExternalEmail = (checked: boolean) =>
    onPatch({ defaults: { ...policy.defaults, externalEmail: checked } })
  const setLinkException = (value: boolean | null) =>
    onPatch({ override: { ...policy.override, externalLinks: value } })
  const setEmailException = (value: boolean | null) =>
    onPatch({ override: { ...policy.override, externalEmail: value } })

  return (
    <section className="w-full max-w-2xl space-y-4 rounded-xl border border-border bg-surface p-4">
      <FieldSet
        legend={t('Hub 默认值')}
        description={t('只控制向组织外的授权，组织成员访问不受影响')}
      >
        <div className="flex flex-col gap-3">
          <Field
            label={t('外发链接')}
            orientation="horizontal"
            hint={t('允许向组织外分享普通链接')}
          >
            <Switch
              checked={policy.defaults.externalLinks}
              loading={saving}
              onCheckedChange={setExternalLinks}
            />
          </Field>
          <Field
            label={t('外部邮箱')}
            orientation="horizontal"
            hint={t('关闭时仅接受已验证的 Hub 成员邮箱')}
          >
            <Switch
              checked={policy.defaults.externalEmail}
              loading={saving}
              onCheckedChange={setExternalEmail}
            />
          </Field>
        </div>
      </FieldSet>
      <FieldSet legend={t('作品例外')} description={t('例外只作用于这一个作品')}>
        <div className="flex flex-col gap-3">
          <PolicyOverrideField
            label={t('外发链接')}
            value={policy.override.externalLinks}
            fallback={policy.defaults.externalLinks}
            disabled={saving}
            onChange={setLinkException}
          />
          <PolicyOverrideField
            label={t('外部邮箱')}
            value={policy.override.externalEmail}
            fallback={policy.defaults.externalEmail}
            disabled={saving}
            onChange={setEmailException}
          />
        </div>
      </FieldSet>
      {error !== null && (
        <p role="alert" className="text-sm text-error">
          {t('保存失败：{reason}', { reason: getRequestErrorMessage(error) })}
        </p>
      )}
    </section>
  )
}
