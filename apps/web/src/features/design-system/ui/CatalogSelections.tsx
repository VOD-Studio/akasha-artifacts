import type { CatalogSelection, CatalogSystem } from '@akasha/protocol'
import { Checkbox } from '@akasha/ui/checkbox'
import { Field } from '@akasha/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useId } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'
import { componentKey } from '../model/review'

interface CatalogSelectionsProps {
  items: readonly CatalogSystem[]
  selections: readonly CatalogSelection[]
  onChange: (selections: CatalogSelection[]) => void
}

/** 用系统 ID 与固定版本寻址；同名系统或同名导出不会互相覆盖。 */
export function CatalogSelections({ items, selections, onChange }: CatalogSelectionsProps) {
  const { t } = useMessages(messages)
  const listId = useId()
  if (items.length === 0) return <p>{t('无可用系统版本')}</p>
  return (
    <fieldset className="space-y-3">
      <legend>{t('最多选择 8 个固定版本')}</legend>
      {items.map((item) => {
        const index = selections.findIndex(
          (entry) => entry.id === item.id && entry.version === item.version,
        )
        const selected = selections[index]
        const label = `${item.title} · ${item.id} · v${item.version}`
        const checkboxId = `${listId}-${item.id}-${item.version}`
        const setComponent = (value: string) => {
          const component = item.components.find((entry) => componentKey(entry) === value)
          onChange(
            selections.map((entry, i) =>
              i === index
                ? { id: item.id, version: item.version, ...(component && { component }) }
                : entry,
            ),
          )
        }
        return (
          <div key={`${item.id}:${item.version}`} className="space-y-2">
            <label htmlFor={checkboxId} className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={!!selected}
                disabled={!selected && selections.length >= 8}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selections, { id: item.id, version: item.version }]
                      : selections.filter((_, i) => i !== index),
                  )
                }
              />
              <bdi className="break-all">{label}</bdi>
            </label>
            {selected && item.components.length > 0 && (
              <Field label={`${t('组件')} · ${label}`}>
                <Select
                  value={selected.component ? componentKey(selected.component) : 'all'}
                  onValueChange={setComponent}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('全部组件')}</SelectItem>
                    {item.components.map((entry) => (
                      <SelectItem key={componentKey(entry)} value={componentKey(entry)}>
                        {componentKey(entry)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        )
      })}
    </fieldset>
  )
}
