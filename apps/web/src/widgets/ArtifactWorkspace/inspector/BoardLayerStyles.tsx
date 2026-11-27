import type { CanvasLayerStyles } from '@akasha/protocol'
import { Skeleton } from '@akasha/ui/skeleton'
import { useMessages } from '@/shared/i18n'
import { panelMessages } from './messages'

interface BoardLayerStylesProps {
  layerId: string
  tag?: string
  label?: string
  styles?: CanvasLayerStyles
}

/** 换选区后只展示新图层的快照，旧快照不作为空结果。 */
export function BoardLayerStyles({ layerId, tag, label, styles }: BoardLayerStylesProps) {
  const { t } = useMessages(panelMessages)
  if (styles?.layerId !== layerId) {
    return (
      <div role="status" className="px-4 py-3.5">
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
  const headerText = [tag ? `<${tag}>` : null, label && label !== `<${tag}>` ? label : null]
    .filter(Boolean)
    .join('  ')
  return (
    <section
      aria-label={t('图层样式')}
      className="min-w-0 space-y-3 border-b border-border/75 px-4 py-3.5 text-xs last:border-b-0"
    >
      {headerText ? (
        <p dir="ltr" className="truncate font-mono text-xs text-ink-muted">
          {headerText}
        </p>
      ) : null}
      {Array.from(groups, ([ancestor, declarations]) => (
        <div key={ancestor ?? ''} className="space-y-1.5">
          <h3 className="text-[11px] font-medium text-ink-muted wrap-anywhere">
            {ancestor === undefined ? (
              t('本层声明')
            ) : (
              <>
                {t('继承自')} <bdi dir="ltr">{ancestor}</bdi>
              </>
            )}
          </h3>
          <dl dir="ltr" className="space-y-1 font-mono text-[12.5px] leading-[1.65] wrap-anywhere">
            {declarations.map(({ source, property, value, important }, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 声明可能重复，只读行按快照顺序展示。
              <div key={index} className="group/decl">
                <dt className="text-[10.5px] leading-4 text-ink-muted/80 whitespace-pre-wrap">
                  {source}
                </dt>
                <dd className="whitespace-pre-wrap text-ink">
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
