import {
  type CatalogCorrection,
  type CatalogGenerateInput,
  type CatalogRecovery,
  CatalogRecoverySchema,
  type CatalogSelection,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { ApiError } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { generateCatalogDesign } from '../api/catalog'
import { messages } from '../messages'
import { CandidateRecovery } from './CandidateOutcome'
import { CandidateSourceEditor } from './CandidateSourceEditor'

interface CandidateSubmissionProps {
  projectId: string
  input: Omit<CatalogGenerateInput, 'candidateSource'>
  ready: boolean
  source: string | null
  onEdit: (source: string | null) => void
  onBusy: (busy: boolean) => void
  onSaved: (id: string, corrections: CatalogCorrection[]) => void
}

/** 只发送文本；恢复动作固定到服务端诊断中的授权版本，不从候选代码推断来源。 */
export function CandidateSubmission({
  projectId,
  input,
  ready,
  source,
  onEdit,
  onBusy,
  onSaved,
}: CandidateSubmissionProps) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const editor = useRef<HTMLTextAreaElement>(null)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState(false)
  const [manual, setManual] = useState<{
    review: CatalogRecovery
    selections: CatalogSelection[] | undefined
    title: string
  } | null>(null)
  const [previewPins, setPreviewPins] = useState<CatalogSelection[]>()
  const review =
    manual && manual.selections === input.selections && manual.title === input.title
      ? manual.review
      : undefined
  const submit = async (regenerate: boolean) => {
    if (!ready || submitting) return
    const request: CatalogGenerateInput = { ...input }
    if (regenerate && review) {
      request.selections ??= review.references.map(({ id, version }) => ({ id, version }))
    } else if (source !== null) {
      request.candidateSource = source
      if (request.selections === undefined && previewPins) request.selections = previewPins
    }
    setSubmitting(true)
    setFailure(false)
    onBusy(true)
    try {
      const { artifact, corrections } = await generateCatalogDesign(projectId, request)
      void cache.invalidateQueries({ queryKey: artifactKeys.lists })
      onSaved(artifact.publicId, corrections)
    } catch (error) {
      const parsed =
        error instanceof ApiError && error.status === 400
          ? CatalogRecoverySchema.safeParse(error.details)
          : null
      if (parsed?.success && !regenerate)
        setManual({ review: parsed.data, selections: input.selections, title: input.title })
      else setFailure(true)
    } finally {
      setSubmitting(false)
      onBusy(false)
    }
  }
  const locate = () => {
    const field = editor.current
    if (!field || !review) return
    let start = 0
    for (let line = 1; line < review.line; line++) {
      const end = field.value.indexOf('\n', start)
      if (end < 0) {
        start = field.value.length
        break
      }
      start = end + 1
    }
    const end = field.value.indexOf('\n', start)
    field.focus()
    field.setSelectionRange(start, end < 0 ? field.value.length : end)
  }
  const edit = (next: string | null) => {
    setManual(null)
    setFailure(false)
    onEdit(next)
  }
  return (
    <div className="space-y-3">
      <CandidateSourceEditor
        projectId={projectId}
        input={input}
        source={source}
        editor={editor}
        canPreview={ready}
        onBusy={onBusy}
        onEdit={edit}
        onLoad={(next, references) => {
          setPreviewPins(
            input.selections === undefined
              ? references?.map(({ id, version }) => ({ id, version }))
              : undefined,
          )
          edit(next)
        }}
      />
      {source !== null && (
        <Button
          variant="ghost"
          onClick={() => {
            setPreviewPins(undefined)
            edit(null)
          }}
        >
          {t('移除候选稿')}
        </Button>
      )}
      {failure && <p role="alert">{t('未能创建设计')}</p>}
      {review && (
        <CandidateRecovery
          recovery={review}
          onLocate={locate}
          onRegenerate={() => void submit(true)}
        />
      )}
      <Button loading={submitting} disabled={!ready} onClick={() => void submit(false)}>
        {t('创建')}
      </Button>
    </div>
  )
}
