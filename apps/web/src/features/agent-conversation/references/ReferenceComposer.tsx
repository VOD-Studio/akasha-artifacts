import { Button } from '@akasha/ui/button'
import { Checkbox } from '@akasha/ui/checkbox'
import { Field } from '@akasha/ui/field'
import { Input } from '@akasha/ui/input'
import { type ChangeEvent, useState } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from './messages'
import type { ReferenceDraft } from './useReferenceDraft'

interface ReferenceComposerProps {
  draft: ReferenceDraft
  disabled: boolean
}

const formats: Record<string, true> = {
  png: true,
  jpeg: true,
  jpg: true,
  docx: true,
  pptx: true,
  md: true,
  txt: true,
  json: true,
  css: true,
  tsx: true,
  jsx: true,
}
const accept = Object.keys(formats)
  .map((format) => `.${format}`)
  .join(',')
const dependencies: Record<string, true> = {
  node_modules: true,
  vendor: true,
  bower_components: true,
  'site-packages': true,
  venv: true,
}
// 只检查路径元数据；打开文件搜索凭证本身就越过了目录授权边界。
const sensitiveName =
  /^tokens?(?:\.|$)|(?:^|[._-])(?:secrets?|credentials?|passwords?|passphrases?|(?:api|access|auth|refresh|bearer)[_-]?tokens?|(?:api|access|private|signing)[_-]?keys?|keys?|service[_-]?accounts?(?:[_-]?keys?)?|client[_-]?secrets?|id_(?:rsa|dsa|ecdsa|ed25519)|kubeconfig|keystore|firebase-adminsdk)(?:[._-]|$)/i
const kinds = { image: '图片', document: '文档', slides: '演示文稿', design: '设计参考' } as const

interface Candidate {
  path: string
  file: File
}

function directoryCandidates(files: FileList) {
  const candidates: Candidate[] = []
  for (const file of files) {
    const dot = file.name.lastIndexOf('.')
    if (dot < 1 || !Object.hasOwn(formats, file.name.slice(dot + 1).toLowerCase())) continue
    if (!file.webkitRelativePath) continue
    const parts = file.webkitRelativePath.split('/')
    if (
      parts.length < 2 ||
      parts.at(-1) !== file.name ||
      parts.some(
        (part) =>
          !part ||
          part.startsWith('.') ||
          Object.hasOwn(dependencies, part.toLowerCase()) ||
          sensitiveName.test(part),
      )
    ) {
      continue
    }
    candidates.push({ path: parts.slice(1).join('/'), file })
  }
  return candidates
}

/** 目录只保留本机候选；父层以项目、会话作用域为 key 挂载，切换时连同勾选一起销毁。 */
export function ReferenceComposer({ draft, disabled }: ReferenceComposerProps) {
  const { t } = useMessages(messages)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [checked, setChecked] = useState(() => new Set<File>())
  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.currentTarget
    if (!files?.length) return
    draft.add(Array.from(files))
    event.currentTarget.value = ''
  }
  const chooseDirectory = (event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.currentTarget
    if (!files?.length) return
    setCandidates(directoryCandidates(files))
    setChecked(new Set())
    event.currentTarget.value = ''
  }
  const toggleCandidate = (file: File, selected: boolean) => {
    setChecked((current) => {
      const next = new Set(current)
      if (selected) next.add(file)
      else next.delete(file)
      return next
    })
  }
  const addChecked = () => {
    if (!candidates || !checked.size) return
    draft.add(candidates.filter(({ file }) => checked.has(file)).map(({ file }) => file))
    const remaining = candidates.filter(({ file }) => !checked.has(file))
    setCandidates(remaining.length ? remaining : null)
    setChecked(new Set())
  }
  return (
    <section className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('添加参考文件')}>
          <Input type="file" multiple accept={accept} disabled={disabled} onChange={chooseFiles} />
        </Field>
        <Field label={t('选择参考目录')} hint={t('仅在本机列出目录中的候选文件，不上传目录。')}>
          <Input
            type="file"
            multiple
            {...{ webkitdirectory: '' }}
            disabled={disabled}
            onChange={chooseDirectory}
          />
        </Field>
      </div>
      {candidates?.length === 0 && (
        <p role="status" className="text-xs text-ink-muted">
          {t('此目录没有可添加的参考文件。')}
        </p>
      )}
      {candidates && candidates.length > 0 && (
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">{t('目录候选（尚未加入本轮）')}</legend>
          <p className="text-xs text-ink-muted">
            {t('勾选后点击「添加所选文件」才会读取文件并生成预览。')}
          </p>
          <ul className="max-h-40 space-y-1 overflow-auto p-1">
            {candidates.map(({ file, path }) => (
              <li key={path} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={path}
                  disabled={disabled}
                  checked={checked.has(file)}
                  onCheckedChange={(value) => toggleCandidate(file, value === true)}
                />
                <bdi className="break-all">{path}</bdi>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || !checked.size}
            onClick={addChecked}
          >
            {t('添加所选文件')}
          </Button>
        </fieldset>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t('本轮参考材料')}</h3>
        <p role="status" className="text-xs text-ink-muted">
          {draft.entries.length === 0 && t('本轮不发送参考材料。')}
          {draft.blocked && t('所有材料就绪后才能发送；也可以移除未就绪的材料。')}
          {!draft.blocked && draft.entries.length > 0 && t('本轮将发送以下材料。')}
        </p>
        <ul aria-label={t('本轮参考材料')} className="space-y-2">
          {draft.entries.map((entry) => (
            <ReferenceItem
              key={entry.key}
              entry={entry}
              disabled={disabled}
              onRetry={draft.retry}
              onRemove={draft.remove}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}

interface ReferenceItemProps {
  entry: ReferenceDraft['entries'][number]
  disabled: boolean
  onRetry: ReferenceDraft['retry']
  onRemove: ReferenceDraft['remove']
}

function ReferenceItem({ entry, disabled, onRetry, onRemove }: ReferenceItemProps) {
  const { t } = useMessages(messages)
  const { key, file, preview, status, error } = entry
  const name = preview?.name ?? file.name
  const kind = preview ? t(kinds[preview.kind]) : file.name.split('.').pop()?.toUpperCase()
  const image = preview?.kind === 'image' ? preview.image : undefined
  const canRetry = status === 'failed' || status === 'expired'
  return (
    <li className="min-w-0 space-y-1 rounded-md border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <bdi className="break-all font-medium">{name}</bdi>
        <span className="text-xs text-ink-muted">
          {kind} · {t('{size} 字节', { size: preview?.bytes ?? file.size })}
        </span>
        {canRetry && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={t('重试 {name}', { name })}
            onClick={() => onRetry(key)}
          >
            {t('重试')}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          aria-label={t('移除 {name}', { name })}
          onClick={() => onRemove(key)}
        >
          {t('移除')}
        </Button>
      </div>
      {status === 'pending' && <p role="status">{t('正在准备材料…')}</p>}
      {status === 'expired' && <p role="status">{t('预览已过期')}</p>}
      {status === 'failed' && <p role="alert">{error || t('材料处理失败')}</p>}
      {status === 'ready' && preview && (
        <details>
          <summary className="cursor-pointer">{t('预览 {name}', { name })}</summary>
          {preview.text !== undefined && (
            <pre
              dir="auto"
              className="max-h-48 overflow-auto whitespace-pre-wrap wrap-anywhere p-1 text-xs"
            >
              {preview.text}
            </pre>
          )}
          {image && /^data:image\/(?:png|jpeg);base64,/.test(image) && (
            <img
              src={image}
              alt={t('图片预览：{name}', { name })}
              loading="lazy"
              className="max-h-48 max-w-full object-contain"
            />
          )}
        </details>
      )}
    </li>
  )
}
