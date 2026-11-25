import { Button } from '@akasha/ui/button'
import { MessageSquare, ScanLine } from 'lucide-react'
import { useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { useMessages } from '@/shared/i18n'
import { messages } from '../messages'

/** 检查器与批注共用一个面板状态，开关不改变画布布局。 */
export function WorkspacePanelButtons({
  feedbackCount,
  hasActiveRound,
}: {
  feedbackCount: number
  hasActiveRound: boolean
}) {
  const { t, number } = useMessages(messages)
  const panel = useWorkspaceStore((state) => state.inspectorTab)
  const setPanel = useWorkspaceStore((state) => state.setInspectorTab)
  const inspectOpen = panel === 'inspect'
  const reviewOpen = panel === 'review'

  const toggleInspect = () => setPanel(inspectOpen ? null : 'inspect')
  const toggleReview = () => {
    useSelectionStore.getState().setFocusedFeedbackId(null)
    setPanel(reviewOpen ? null : 'review')
  }

  return (
    <>
      <Button
        variant={inspectOpen ? 'secondary' : 'ghost'}
        size="sm"
        iconOnly
        aria-label={t('检查器')}
        title={t('检查器')}
        aria-expanded={inspectOpen}
        aria-haspopup="dialog"
        aria-controls={inspectOpen ? 'design-inspector' : undefined}
        onClick={toggleInspect}
      >
        <ScanLine size={15} />
      </Button>
      <Button
        variant={reviewOpen ? 'secondary' : 'ghost'}
        size="sm"
        leftIcon={<MessageSquare size={14} />}
        aria-expanded={reviewOpen}
        aria-haspopup="dialog"
        aria-controls={reviewOpen ? 'artifact-inspector' : undefined}
        onClick={toggleReview}
      >
        {hasActiveRound ? t('评审') : t('批注')}
        {feedbackCount > 0 && ` ${number(feedbackCount)}`}
      </Button>
    </>
  )
}
