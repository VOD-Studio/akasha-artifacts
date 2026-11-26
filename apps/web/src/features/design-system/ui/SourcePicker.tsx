import type { DesignSystemDraft } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { type ChangeEvent, useState } from 'react'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import {
  accepts,
  type FileChoice,
  figmaReference,
  fileChoices,
  readChosenFiles,
} from '../lib/selected-files'
import { messages } from '../messages'

interface SourcePickerProps {
  origin: DesignSystemDraft['origin']
  canResync: boolean
  onOrigin: (value: DesignSystemDraft['origin']) => void
  onImport: (files: DesignSystemDraft['files'], replace: boolean, sourceLabel: string) => void
  onReading: (busy: boolean) => void
  onPending: (pending: boolean) => void
}

export function SourcePicker({
  origin,
  canResync,
  onOrigin,
  onImport,
  onReading,
  onPending,
}: SourcePickerProps) {
  const { t } = useMessages(messages)
  const [choices, setChoices] = useState<FileChoice[]>([])
  const [checked, setChecked] = useState<Set<File>>(new Set())
  const [url, setUrl] = useState('')
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const choose = (event: ChangeEvent<HTMLInputElement>, directory: boolean) => {
    if (!event.target.files?.length) return
    try {
      const next = fileChoices(event.target.files)
      setChoices(next)
      onPending(next.length > 0)
      setChecked(new Set(directory ? [] : next.map((entry) => entry.file)))
      setError(next.length ? '' : t('没有支持的文件'))
    } catch (reason) {
      setError(getRequestErrorMessage(reason))
    } finally {
      event.target.value = ''
    }
  }
  const toggle = (file: File) =>
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(file)) next.delete(file)
      else next.add(file)
      return next
    })
  const clearSelection = () => {
    setChoices([])
    setChecked(new Set())
    onPending(false)
  }
  const apply = async (replace: boolean) => {
    if (reading || !checked.size) return
    setReading(true)
    onReading(true)
    setError('')
    try {
      const selected = choices.filter(({ file }) => checked.has(file))
      const files = await readChosenFiles(selected)
      const first = selected[0]
      onImport(files, replace, first.file.webkitRelativePath?.split('/')[0] || first.path)
      clearSelection()
    } catch (reason) {
      setError(getRequestErrorMessage(reason))
    } finally {
      setReading(false)
      onReading(false)
    }
  }
  const addReference = () => {
    const reference = figmaReference(url)
    if (!reference) {
      setError(t('请输入 HTTPS 的 Figma 链接。'))
      return
    }
    onImport([reference], false, 'Figma')
    setUrl('')
    setError('')
  }
  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('来源')}>
          <Select
            value={origin.kind}
            onValueChange={(value) =>
              onOrigin({ ...origin, kind: value === 'github-checkout' ? value : 'local' })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">{t('本机文件')}</SelectItem>
              <SelectItem value="github-checkout">{t('已授权的 GitHub 检出目录')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('来源名称')}>
          <Input
            value={origin.label}
            dir="auto"
            onChange={(event) => onOrigin({ ...origin, label: event.target.value })}
          />
        </Field>
        <Field label={t('选择文件')}>
          <Input type="file" multiple accept={accepts} onChange={(event) => choose(event, false)} />
        </Field>
        <Field label={t('选择目录')}>
          <Input
            type="file"
            multiple
            {...{ webkitdirectory: '' }}
            onChange={(event) => choose(event, true)}
          />
        </Field>
      </div>
      {choices.length > 0 && (
        <>
          <p className="text-xs text-ink-muted">{t('仅勾选的文件会被读取和导入。')}</p>
          <ul className="max-h-48 space-y-1 overflow-auto p-1">
            {choices.map((choice) => (
              <li key={choice.path} className="flex items-center gap-2">
                <Checkbox
                  aria-label={choice.path}
                  checked={checked.has(choice.file)}
                  onCheckedChange={() => toggle(choice.file)}
                />
                <bdi>{choice.path}</bdi>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!checked.size}
              loading={reading}
              onClick={() => void apply(false)}
            >
              {t('添加所选文件')}
            </Button>
            {canResync && (
              <Button variant="outline" disabled={!checked.size} onClick={() => void apply(true)}>
                {t('用所选文件重新同步')}
              </Button>
            )}
            <Button variant="ghost" onClick={clearSelection}>
              {t('取消选择')}
            </Button>
          </div>
          {canResync && <p className="text-xs text-ink-muted">{t('未选中的旧文件将列为缺失。')}</p>}
        </>
      )}
      <Field label={t('Figma 参考链接')}>
        <Input type="url" dir="ltr" value={url} onChange={(event) => setUrl(event.target.value)} />
      </Field>
      <Button size="sm" variant="outline" disabled={!url.trim()} onClick={addReference}>
        {t('添加参考')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
