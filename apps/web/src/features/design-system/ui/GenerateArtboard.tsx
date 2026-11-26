import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@akasha/ui/select'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { generateArtboard } from '../api/client'
import { messages } from '../messages'
import { type ComponentEntry, componentKey } from '../model/review'

interface GenerateArtboardProps {
  projectId: string
  id: string
  version: number
  components: readonly ComponentEntry[]
  onOpenArtifact: (id: string) => void
}

/** 只从已展示的不可变系统版本生成，不以 head 替代版本。 */
export function GenerateArtboard({
  projectId,
  id,
  version,
  components,
  onOpenArtifact,
}: GenerateArtboardProps) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState(() => `design/${crypto.randomUUID()}`)
  const [selected, setSelected] = useState('all')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generate = async () => {
    if (busy || !title.trim() || !slug.trim()) return
    setBusy(true)
    setError('')
    try {
      const entry = components.find((component) => componentKey(component) === selected)
      const { artifact } = await generateArtboard(projectId, {
        id,
        version,
        title,
        slug,
        ...(entry && { component: { path: entry.path, exportName: entry.exportName } }),
      })
      void cache.invalidateQueries({ queryKey: artifactKeys.lists })
      onOpenArtifact(artifact.publicId)
    } catch (reason) {
      setError(getRequestErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset disabled={busy} className="space-y-3 border-t border-border pt-4">
      <legend className="font-medium">
        {t('从此版本生成画板')} · v{version}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('画板名称')}>
          <Input dir="auto" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label={t('别名')}>
          <Input dir="ltr" value={slug} onChange={(event) => setSlug(event.target.value)} />
        </Field>
      </div>
      {components.length > 0 && (
        <Field label={t('组件')}>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('全部组件')}</SelectItem>
              {components.map((entry) => (
                <SelectItem key={componentKey(entry)} value={componentKey(entry)}>
                  {componentKey(entry)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        disabled={!title.trim() || !slug.trim()}
        loading={busy}
        onClick={() => void generate()}
      >
        {t('生成画板')}
      </Button>
    </fieldset>
  )
}
