import { readCatalogReferences, readDesignSystemReference } from '@akasha/protocol'
import { useMemo } from 'react'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 定位到生成时固定的来源；普通作品链接不会把当前画板的授权传给设计系统。 */
export function SystemSourceLink({ source }: { source: string }) {
  const { t } = useMessages(messages)
  const { references, legacy } = useMemo(() => {
    const catalog = readCatalogReferences(source)
    if (catalog) return { references: catalog, legacy: false }
    const single = readDesignSystemReference(source)
    return { references: single ? [single] : [], legacy: !!single }
  }, [source])
  if (!references.length) return null
  return (
    <aside className="border-b border-border px-3 py-1.5 text-xs">
      <details>
        <summary>
          {legacy ? `${t('设计系统')} · v${references[0].version}` : t('本次使用的固定来源')}
        </summary>
        {references.map((reference) => (
          <div
            key={`${reference.id}:${reference.version}`}
            className="flex flex-wrap gap-x-3 gap-y-1 py-1"
          >
            {legacy && (
              <a
                className="underline"
                href={`/a/${encodeURIComponent(reference.id)}/v/${reference.version}`}
              >
                <bdi>
                  {reference.id} · v{reference.version}
                </bdi>
              </a>
            )}
            {!legacy && (
              <bdi>
                {reference.id} · v{reference.version}
              </bdi>
            )}
            <span>
              {t('来源指纹')} <bdi>{reference.sourceVersion}</bdi>
            </span>
            {reference.components.map(({ path, exportName }) => (
              <code key={`${path}#${exportName}`} dir="ltr">
                {path}#{exportName}
              </code>
            ))}
          </div>
        ))}
      </details>
    </aside>
  )
}
