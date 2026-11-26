import type { DesignSystemDraft } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { Textarea } from '@akasha/ui/textarea'
import { useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'
import { type ComponentEntry, componentKey } from '../model/review'

interface ComponentSelectionProps {
  draft: DesignSystemDraft
  previous?: DesignSystemDraft
  onChange: (components: ComponentEntry[]) => void
}

function parseProps(value: string): ComponentEntry['props'] | undefined {
  try {
    const data = JSON.parse(value)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    if (Object.values(data).every((v) => ['string', 'number', 'boolean'].includes(typeof v)))
      return data
  } catch {
    return
  }
}

export function ComponentSelection({ draft, previous, onChange }: ComponentSelectionProps) {
  const { t } = useMessages(messages)
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('default')
  const [params, setParams] = useState('{}')
  const sources = draft.files.filter(
    (file) => file.kind === 'source' && /\.[jt]sx?$/i.test(file.path),
  )
  const path = sources.some((file) => file.path === selected) ? selected : sources[0]?.path
  const props = parseProps(params)
  const existing = draft.components.some(
    (entry) => entry.path === path && entry.exportName === name.trim(),
  )
  const add = () => {
    if (!props || !path || !name.trim()) return
    const next = { path, exportName: name.trim(), props }
    onChange([
      ...draft.components.filter((entry) => componentKey(entry) !== componentKey(next)),
      next,
    ])
  }
  return (
    <section className="space-y-3">
      <h3 className="font-medium">{t('组件')}</h3>
      {draft.components.map((entry) => {
        const key = componentKey(entry)
        const before = previous?.components.find((item) => componentKey(item) === key)
        return (
          <div key={key} className="flex flex-wrap items-center gap-2">
            <code dir="ltr">{key}</code>
            <code dir="ltr">{JSON.stringify(entry.props)}</code>
            {previous && !before && <span>{t('新增')}</span>}
            {before && JSON.stringify(before.props) !== JSON.stringify(entry.props) && (
              <span>{t('已变更')}</span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelected(entry.path)
                setName(entry.exportName)
                setParams(JSON.stringify(entry.props))
              }}
            >
              {t('编辑参数')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${t('移除')} ${key}`}
              onClick={() =>
                onChange(draft.components.filter((item) => componentKey(item) !== key))
              }
            >
              {t('移除')}
            </Button>
          </div>
        )
      })}
      {sources.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('组件入口')}>
              <Select value={path ?? ''} onValueChange={setSelected}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((file) => (
                    <SelectItem key={file.path} value={file.path}>
                      {file.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('导出名称')}>
              <Input value={name} dir="ltr" onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <Field
            label={t('组件参数（JSON）')}
            error={props ? undefined : t('参数必须是字符串、数字或布尔值的 JSON 对象。')}
          >
            <Textarea
              rows={2}
              dir="ltr"
              value={params}
              onChange={(event) => setParams(event.target.value)}
            />
          </Field>
          <Button variant="outline" size="sm" disabled={!props || !name.trim()} onClick={add}>
            {existing ? t('更新组件') : t('添加组件')}
          </Button>
        </>
      )}
    </section>
  )
}
