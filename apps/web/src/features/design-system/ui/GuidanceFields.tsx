import type { DesignSystemDraft } from '@akasha/protocol'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Textarea } from '@akasha/ui/textarea'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

type Guidance = DesignSystemDraft['guidance']
interface GuidanceFieldsProps {
  guidance: Guidance
  onChange?: (next: Guidance) => void
}

export function GuidanceFields({ guidance, onChange }: GuidanceFieldsProps) {
  const { t } = useMessages(messages)
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field className="sm:col-span-3" label={t('使用说明')}>
        <Textarea
          rows={3}
          dir="auto"
          readOnly={!onChange}
          value={guidance.instructions}
          onChange={(event) => onChange?.({ ...guidance, instructions: event.target.value })}
        />
      </Field>
      <Field label={t('字体')}>
        <Input
          readOnly={!onChange}
          dir="auto"
          value={guidance.fontFamily}
          onChange={(event) => onChange?.({ ...guidance, fontFamily: event.target.value })}
        />
      </Field>
      <Field label={t('颜色')}>
        <Input
          readOnly={!onChange}
          dir="ltr"
          value={guidance.color}
          onChange={(event) => onChange?.({ ...guidance, color: event.target.value })}
        />
      </Field>
      <Field label={t('间距（px）')}>
        <Input
          type="number"
          min={0}
          max={512}
          readOnly={!onChange}
          value={Number.isFinite(guidance.spacing) ? guidance.spacing : ''}
          onChange={(event) => onChange?.({ ...guidance, spacing: event.target.valueAsNumber })}
        />
      </Field>
    </div>
  )
}
