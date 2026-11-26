import {
  CATALOG_REQUEST_BYTES,
  type CatalogGenerateInput,
  type DesignSystemReference,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { Textarea } from '@akasha/ui/textarea'
import { type RefObject, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { readContent } from '@/shared/lib/selected-file'
import { previewCatalogDesign } from '../api/catalog'
import { messages } from '../messages'

interface CandidateSourceEditorProps {
  projectId: string
  input: Omit<CatalogGenerateInput, 'candidateSource'>
  source: string | null
  editor: RefObject<HTMLTextAreaElement | null>
  canPreview: boolean
  onBusy: (busy: boolean) => void
  onEdit: (source: string) => void
  onLoad: (source: string, references?: DesignSystemReference[]) => void
}

/** 只把授权文件或基准作为文本载入；替换已有候选稿必须显式确认。 */
export function CandidateSourceEditor({
  projectId,
  input,
  source,
  editor,
  canPreview,
  onBusy,
  onEdit,
  onLoad,
}: CandidateSourceEditorProps) {
  const { t } = useMessages(messages)
  const [replacement, setReplacement] = useState<{
    source: string
    references?: DesignSystemReference[]
  } | null>(null)
  const [loading, setLoading] = useState<'file' | 'baseline' | null>(null)
  const [error, setError] = useState<'无法载入候选稿' | '文件超出导入限制。' | null>(null)
  const load = async (file?: File) => {
    setError(null)
    setReplacement(null)
    if (file && file.size > CATALOG_REQUEST_BYTES) {
      setError('文件超出导入限制。')
      return
    }
    setLoading(file ? 'file' : 'baseline')
    onBusy(true)
    try {
      const next = file
        ? { source: await readContent(file, false), references: undefined }
        : await previewCatalogDesign(projectId, input)
      if (source !== null && next.source !== source) setReplacement(next)
      else onLoad(next.source, next.references)
    } catch {
      setError('无法载入候选稿')
    } finally {
      setLoading(null)
      onBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        loading={loading === 'baseline'}
        disabled={!canPreview || !!loading}
        onClick={() => void load()}
      >
        {t('载入所选版本基准')}
      </Button>
      <Field label={t('导入候选稿')}>
        <Input
          type="file"
          accept=".jsx,.tsx,.js,.ts,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void load(file)
          }}
        />
      </Field>
      {replacement && (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              onLoad(replacement.source, replacement.references)
              setReplacement(null)
            }}
          >
            {t('替换当前候选稿')}
          </Button>
          <Button variant="outline" onClick={() => setReplacement(null)}>
            {t('保留当前候选稿')}
          </Button>
        </div>
      )}
      {error && <p role="alert">{t(error)}</p>}
      <Field label={t('候选稿源码')}>
        <Textarea
          ref={editor}
          dir="ltr"
          spellCheck={false}
          rows={7}
          value={source ?? ''}
          onChange={(event) => {
            setReplacement(null)
            onEdit(event.target.value)
          }}
        />
      </Field>
    </div>
  )
}
