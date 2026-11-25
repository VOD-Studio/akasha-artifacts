import type { CanvasLayerStyles } from '@akasha/protocol'
import { Skeleton } from '@akasha/ui/skeleton'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from './messages'

interface BoardLayerStylesProps {
  layerId: string
  styles?: CanvasLayerStyles
}

/** 换选区后只展示新图层的快照，旧快照不作为空结果。 */
export function BoardLayerStyles({ layerId, styles }: BoardLayerStylesProps) {
  const { t } = useMessages(panelMessages)
  if (styles?.layerId !== layerId) {
    return (
      <div role="status">
        <span className="sr-only">{t('正在读取图层样式')}</span>
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const groups = new Map<string | undefined, CanvasLayerStyles['declarations'][number][]>()
  for (const declaration of styles.declarations) {
    const group = groups.get(declaration.inheritedFrom)
    if (group) group.push(declaration)
    else groups.set(declaration.inheritedFrom, [declaration])
  }
  return (
    <section aria-label={t('图层样式')} className="min-w-0 space-y-3 text-xs">
      {Array.from(groups, ([ancestor, declarations]) => (
        <div key={ancestor ?? ''} className="space-y-1">
          <h3 className="text-sm font-medium wrap-anywhere">
            {ancestor === undefined ? (
              t('本层声明')
            ) : (
              <>
                {t('继承自')} <bdi dir="ltr">{ancestor}</bdi>
              </>
            )}
          </h3>
          <dl dir="ltr" className="space-y-2 rounded-md border p-2 font-mono wrap-anywhere">
            {declarations.map(({ source, property, value, important }, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 声明可能重复，只读行按快照顺序展示。
              <div key={index}>
                <dt className="text-ink-muted whitespace-pre-wrap">{source}</dt>
                <dd className="whitespace-pre-wrap">
                  {`${property}: ${value}${important ? ' !important' : ''};`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      {!groups.size && !styles.truncated && (
        <p className="text-ink-muted">{t('没有可归属的样式声明')}</p>
      )}
      {styles.truncated && <p className="text-ink-muted">{t('样式声明不完整')}</p>}
    </section>
  )
}
