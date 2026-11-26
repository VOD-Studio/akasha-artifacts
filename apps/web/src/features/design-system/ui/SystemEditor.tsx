import {
  type DesignSystemDraft,
  type DesignSystemPreviewOutput,
  type DesignSystemWriteOutput,
  removedDesignSystemItems,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { artifactKeys } from '@/entities/artifact'
import { getRequestErrorMessage } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { previewSystem, publishSystem } from '../api/client'
import { messages } from '../messages'
import { emptyDraft, importFiles, restoreItem } from '../model/review'
import { AssetReview } from './AssetReview'
import { ComponentSelection } from './ComponentSelection'
import { GuidanceFields } from './GuidanceFields'
import { SourcePicker } from './SourcePicker'
import { SystemPreview } from './SystemPreview'

export interface SystemBaseline {
  draft: DesignSystemDraft
  id: string
  version: number
  title: string
  slug: string
}
interface SystemEditorProps {
  projectId: string
  sandboxOrigin: string
  baseline?: SystemBaseline
  onSaved: (result: DesignSystemWriteOutput) => void
}

/** 保存只接受本次草稿渲染成功的回执。更新草稿即撤销构建许可，失败保留全部输入。 */
export function SystemEditor({ projectId, sandboxOrigin, baseline, onSaved }: SystemEditorProps) {
  const { t } = useMessages(messages)
  const cache = useQueryClient()
  const removalGroup = useId()
  const [draft, setDraft] = useState(baseline?.draft ?? emptyDraft)
  const [title, setTitle] = useState(baseline?.title ?? '')
  const [slug, setSlug] = useState(() => baseline?.slug ?? `design-system/${crypto.randomUUID()}`)
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [pendingFiles, setPendingFiles] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<DesignSystemPreviewOutput | null>(null)
  const [rendered, setRendered] = useState(false)
  const missing = baseline ? removedDesignSystemItems(baseline.draft, draft) : []
  const unresolved = missing.some((key) => !confirmed.includes(key))
  const needsBuild = draft.files.some((file) => file.kind === 'source')
  const restoreLabel = (key: string) =>
    key.startsWith('component:') ? t('恢复整个旧入口文件') : t('保留旧项')
  const mayPreview =
    !pendingFiles &&
    !!draft.origin.label.trim() &&
    draft.files.length > 0 &&
    (!needsBuild || draft.components.length > 0) &&
    !unresolved
  const change = (next: DesignSystemDraft) => {
    setDraft(next)
    setError('')
    setPreview(null)
    setRendered(false)
    const removed = baseline ? removedDesignSystemItems(baseline.draft, next) : []
    setConfirmed((current) => current.filter((key) => removed.includes(key)))
  }
  const build = async () => {
    if (busy || reading || !mayPreview) return
    setBusy('preview')
    setPreview(null)
    setRendered(false)
    setError('')
    try {
      setPreview(await previewSystem(projectId, { draft, buildApproved: needsBuild }))
    } catch (reason) {
      setError(getRequestErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }
  const save = async () => {
    if (busy || reading || pendingFiles || !preview || !rendered || unresolved) return
    setBusy('save')
    setError('')
    try {
      const result = await publishSystem(projectId, {
        draft,
        buildApproved: needsBuild,
        reviewToken: preview.reviewToken,
        slug,
        title,
        ...(baseline && { id: baseline.id, baseVersion: baseline.version }),
        confirmedRemovals: missing.filter((key) => confirmed.includes(key)),
      })
      void cache.invalidateQueries({ queryKey: artifactKeys.all })
      onSaved(result)
    } catch (reason) {
      setError(getRequestErrorMessage(reason))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="space-y-4 text-sm">
      <fieldset className="min-w-0 space-y-5" disabled={!!busy || reading}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('系统名称')}>
            <Input value={title} dir="auto" onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label={t('别名')}>
            <Input
              value={slug}
              dir="ltr"
              readOnly={!!baseline}
              onChange={(event) => setSlug(event.target.value)}
            />
          </Field>
        </div>
        <SourcePicker
          origin={draft.origin}
          canResync={!!baseline}
          onReading={setReading}
          onPending={setPendingFiles}
          onOrigin={(origin) => change({ ...draft, origin })}
          onImport={(files, replace, label) =>
            change({
              ...importFiles(draft, files, replace),
              origin: draft.origin.label.trim() ? draft.origin : { ...draft.origin, label },
            })
          }
        />
        <AssetReview
          files={draft.files}
          previous={baseline?.draft}
          onChange={(files) =>
            change({
              ...draft,
              files,
              components: draft.components.filter((entry) =>
                files.some((file) => file.path === entry.path),
              ),
            })
          }
        />
        <ComponentSelection
          draft={draft}
          previous={baseline?.draft}
          onChange={(components) => change({ ...draft, components })}
        />
        {baseline && missing.length > 0 && (
          <section className="space-y-2">
            <h3 className="font-medium">{t('缺失')}</h3>
            {missing.map((key) => (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <bdi className="break-all">{key}</bdi>
                {key.startsWith('component:') && (
                  <span className="text-xs text-ink-muted">
                    {t('同一文件中的其他组件也将使用旧源码。')}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${restoreLabel(key)} ${key}`}
                  onClick={() => change(restoreItem(draft, baseline.draft, key))}
                >
                  {restoreLabel(key)}
                </Button>
                <label
                  htmlFor={`${removalGroup}-${encodeURIComponent(key)}`}
                  className="flex items-center gap-1"
                >
                  <Checkbox
                    id={`${removalGroup}-${encodeURIComponent(key)}`}
                    aria-label={`${t('确认移除')} ${key}`}
                    checked={confirmed.includes(key)}
                    onCheckedChange={(checked) =>
                      setConfirmed((current) =>
                        checked === true
                          ? [...current, key]
                          : current.filter((item) => item !== key),
                      )
                    }
                  />
                  {t('确认移除')}
                </label>
              </div>
            ))}
          </section>
        )}
        <GuidanceFields
          guidance={draft.guidance}
          onChange={(guidance) => change({ ...draft, guidance })}
        />
        <Button
          variant="outline"
          disabled={!mayPreview}
          loading={busy === 'preview'}
          onClick={() => void build()}
        >
          {needsBuild ? t('允许构建并预览所选组件') : t('预览品牌资料')}
        </Button>
      </fieldset>
      {preview && (
        <SystemPreview
          key={preview.reviewToken}
          source={preview.previewSource}
          sandboxOrigin={sandboxOrigin}
          onRendered={setRendered}
        />
      )}
      {error && (
        <p role="alert" className="break-words text-danger">
          {error}
        </p>
      )}
      <Button
        disabled={
          !preview ||
          !rendered ||
          unresolved ||
          pendingFiles ||
          !title.trim() ||
          !slug.trim() ||
          !!busy ||
          reading
        }
        loading={busy === 'save'}
        onClick={() => void save()}
      >
        {t('保存系统版本')}
      </Button>
    </div>
  )
}
