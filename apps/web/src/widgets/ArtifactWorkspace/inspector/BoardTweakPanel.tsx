import type { ArtboardTweak, ArtboardTweakValues } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Segmented } from '@akasha/ui/segmented'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Switch } from '@akasha/ui/switch'
import { useState } from 'react'
import { useStore } from 'zustand'
import { useMessages } from '@/shared/i18n'
import type { BoardTweakPreviewStore } from '../model/board-tweak-previews'
import { tweakApplyMessages } from './board-tweak-apply-messages'
import { panelMessages } from './messages'

interface BoardTweakPanelProps {
  boardId: string
  tweaks: readonly ArtboardTweak[]
  /** 同一版本内换板保留覆写；切版本由工作区重新创建。 */
  previews: BoardTweakPreviewStore
  /** 仅对可写头版本开放；传出本板实际覆写的值，不含其余默认值。 */
  onApply?: (values: ArtboardTweakValues) => void
}

/** 控件只改本会话的预览；发布动作须另行确认范围。 */
export function BoardTweakPanel({ boardId, tweaks, previews, onApply }: BoardTweakPanelProps) {
  const { t, locale } = useMessages(panelMessages)
  const { t: applyText } = useMessages(tweakApplyMessages)
  const overrides = useStore(previews, (state) => state.byBoard.get(boardId))

  return (
    <section className="flex flex-col gap-3" aria-label={t('画板参数预览')}>
      <p className="text-xs text-ink-muted">
        {onApply
          ? applyText('仅在此预览。发布新版本后，所选画板才会使用这些值。')
          : t('仅预览当前画板，不会保存或随作品导出。')}
      </p>
      {tweaks.map((tweak) => (
        <TweakControl
          key={tweak.id}
          tweak={tweak}
          value={
            overrides && Object.hasOwn(overrides, tweak.id) ? overrides[tweak.id] : tweak.default
          }
          locale={locale}
          onChange={(value) => previews.getState().set(boardId, tweak, value)}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!overrides}
          onClick={() => previews.getState().reset(boardId)}
        >
          {t('重置本板')}
        </Button>
        {onApply && (
          <Button size="sm" disabled={!overrides} onClick={() => overrides && onApply(overrides)}>
            {applyText('应用参数…')}
          </Button>
        )}
      </div>
    </section>
  )
}

function localizedLabel(
  { label, labels }: { label: string; labels?: Record<string, string> },
  locale: string,
) {
  if (!labels) return label
  let candidate = locale.toLowerCase()
  while (candidate) {
    for (const [key, value] of Object.entries(labels)) {
      if (key.toLowerCase() === candidate) return value
    }
    const separator = candidate.lastIndexOf('-')
    if (separator < 0) break
    candidate = candidate.slice(0, separator)
  }
  return label
}

interface TweakControlProps {
  tweak: ArtboardTweak
  value: ArtboardTweakValues[string]
  locale: string
  onChange: (value: ArtboardTweakValues[string]) => void
}

function TweakControl({ tweak, value, locale, onChange }: TweakControlProps) {
  const label = localizedLabel(tweak, locale)
  switch (tweak.type) {
    case 'number':
      return (
        <TweakNumberInput
          label={label}
          tweak={tweak}
          value={typeof value === 'number' ? value : tweak.default}
          onChange={onChange}
        />
      )
    case 'enum': {
      const currentValue = typeof value === 'string' ? value : tweak.default
      if (tweak.options.length <= 4) {
        return (
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-ink">{label}</span>
            <Segmented
              block
              size="sm"
              aria-label={label}
              value={currentValue}
              onValueChange={onChange}
              segments={tweak.options.map((option) => ({
                value: option.value,
                label: localizedLabel(option, locale),
              }))}
            />
          </div>
        )
      }
      return (
        <Field label={label}>
          <Select value={currentValue} onValueChange={onChange}>
            <SelectTrigger controlSize="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tweak.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {localizedLabel(option, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )
    }
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3 py-0.5">
          <span className="text-xs font-medium text-ink">{label}</span>
          <Switch
            size="sm"
            aria-label={label}
            checked={value === true}
            onCheckedChange={(next) => onChange(next === true)}
          />
        </div>
      )
    case 'color': {
      const currentColor = typeof value === 'string' ? value : tweak.default
      return (
        <Field label={label}>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-subtle px-2 py-1">
            <label className="relative inline-flex size-5 shrink-0 cursor-pointer overflow-hidden rounded border border-black/10">
              <span className="sr-only">{label}</span>
              <input
                type="color"
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                value={currentColor}
                onChange={(event) => onChange(event.target.value)}
              />
              <span
                aria-hidden="true"
                className="size-full"
                style={{ backgroundColor: currentColor }}
              />
            </label>
            <span dir="ltr" className="font-mono text-xs text-ink uppercase">
              {currentColor}
            </span>
          </div>
        </Field>
      )
    }
  }
}

interface TweakNumberInputProps {
  label: string
  tweak: Extract<ArtboardTweak, { type: 'number' }>
  value: number
  onChange: (value: number) => void
}

function TweakNumberInput({ label, tweak, value, onChange }: TweakNumberInputProps) {
  const { t, number } = useMessages(panelMessages)
  const [draft, setDraft] = useState<{ text: string; value: number; invalid: boolean } | null>(null)
  const current = draft?.value === value ? draft : null
  const { min, max } = tweak
  return (
    <Field
      label={label}
      hint={`${number(min)}–${number(max)}`}
      error={current?.invalid ? t('请输入 {min}–{max}', { min, max }) : undefined}
    >
      <Input
        type="number"
        controlSize="sm"
        step="any"
        min={min}
        max={max}
        value={current?.text ?? value}
        onBlur={() => setDraft(null)}
        onChange={({ currentTarget }) => {
          const next = currentTarget.valueAsNumber
          const valid = Number.isFinite(next) && next >= min && next <= max
          setDraft({ text: currentTarget.value, value: valid ? next : value, invalid: !valid })
          if (valid) onChange(next)
        }}
      />
    </Field>
  )
}
