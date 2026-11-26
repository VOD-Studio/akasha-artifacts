import type { CatalogCorrection, CatalogRecovery } from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'
import { componentKey } from '../model/review'

interface CandidateRecoveryProps {
  recovery: CatalogRecovery
  onLocate: () => void
  onRegenerate: () => void
}

const reasons = {
  structure: '候选稿结构已变更',
  reference: '固定来源不匹配',
  instance: '组件实例不匹配',
} as const

/** 行号相对于候选原稿；重新生成不替换输入框，也不沿用未经校验的来源信息。 */
export function CandidateRecovery({ recovery, onLocate, onRegenerate }: CandidateRecoveryProps) {
  const { t } = useMessages(messages)
  return (
    <div className="space-y-2" role="alert">
      <p>
        {t(reasons[recovery.reason])} · {t('第 {line} 行', { line: recovery.line })}
      </p>
      <ul>
        {recovery.references.map((ref) => (
          <li key={`${ref.id}:${ref.version}`} className="flex flex-wrap gap-2">
            <bdi>
              {ref.id} · v{ref.version}
            </bdi>
            {ref.components.map((component) => (
              <code key={componentKey(component)} dir="ltr">
                {componentKey(component)}
              </code>
            ))}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onLocate}>
          {t('定位并编辑')}
        </Button>
        <Button variant="outline" onClick={onRegenerate}>
          {t('按固定版本重新生成')}
        </Button>
      </div>
    </div>
  )
}

interface SavedCorrectionsProps {
  corrections: readonly CatalogCorrection[]
  onOpen: () => void
}

/** 已持久化后只提供打开操作，不再显示生成按钮。 */
export function SavedCorrections({ corrections, onOpen }: SavedCorrectionsProps) {
  const { t } = useMessages(messages)
  return (
    <div className="space-y-3">
      <ul className="space-y-1" role="status">
        {corrections.map((item) => (
          <li
            key={`${item.id}:${item.version}:${item.kind}:${item.component && componentKey(item.component)}`}
            className="flex flex-wrap gap-2"
          >
            <span>{t(item.kind === 'guidance' ? '已恢复规范' : '已恢复组件')}</span>
            <bdi>
              {item.id} · v{item.version}
            </bdi>
            {item.component && <code dir="ltr">{componentKey(item.component)}</code>}
          </li>
        ))}
      </ul>
      <Button onClick={onOpen}>{t('打开修正版')}</Button>
    </div>
  )
}
