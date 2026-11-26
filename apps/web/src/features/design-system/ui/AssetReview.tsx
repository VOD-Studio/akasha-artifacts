import type { DesignSystemDraft } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { Textarea } from '@akasha/ui/textarea'
import { useMemo } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

interface AssetReviewProps {
  files: DesignSystemDraft['files']
  previous?: DesignSystemDraft
  onChange?: (files: DesignSystemDraft['files']) => void
}

export function AssetReview({ files, previous, onChange }: AssetReviewProps) {
  const { t } = useMessages(messages)
  const beforeByPath = useMemo(
    () => new Map(previous?.files.map((file) => [file.path, file])),
    [previous],
  )
  return (
    <section className="space-y-2">
      <h3 className="font-medium">{t('文件与品牌资产')}</h3>
      {!files.length && <p className="text-ink-muted">{t('无文件')}</p>}
      <ul className="space-y-2">
        {files.map((file) => {
          const before = beforeByPath.get(file.path)
          const changed = before && (before.content !== file.content || before.kind !== file.kind)
          const text =
            file.kind === 'source' ||
            file.kind === 'guidelines' ||
            (file.kind === 'figma' && file.content.startsWith('https://'))
          return (
            <li key={file.path} className="rounded-8 border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <bdi className="break-all">{file.path}</bdi>
                {previous && !before && <span>{t('新增')}</span>}
                {changed && <span>{t('已变更')}</span>}
                {onChange && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t('移除')} ${file.path}`}
                    onClick={() => onChange(files.filter((entry) => entry.path !== file.path))}
                  >
                    {t('移除')}
                  </Button>
                )}
              </div>
              {text && (
                <details className="mt-1">
                  <summary>{t('来源')}</summary>
                  {file.kind === 'guidelines' && onChange ? (
                    <Textarea
                      aria-label={file.path}
                      dir="auto"
                      value={file.content}
                      onChange={(event) =>
                        onChange(
                          files.map((entry) =>
                            entry.path === file.path
                              ? { ...file, content: event.target.value }
                              : entry,
                          ),
                        )
                      }
                    />
                  ) : (
                    <pre
                      dir="auto"
                      className="max-h-48 overflow-auto whitespace-pre-wrap break-all"
                    >
                      {file.content}
                    </pre>
                  )}
                </details>
              )}
              {changed && text && before.kind === file.kind && (
                <details className="mt-1">
                  <summary>{t('上一版来源')}</summary>
                  <pre dir="auto" className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                    {before.content}
                  </pre>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
