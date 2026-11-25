import type { Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { CheckCheck, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore } from '@/entities/workspace'
import { isAccessDenied } from '@/shared/api/error'
import { useMessages } from '@/shared/i18n'
import { useSubmitRoundMutation, useWithdrawRoundMutation } from '../api/mutations'
import { panelMessages } from '../messages'
import { summarizeRoundProgress } from '../model/round-utils'

export interface RoundSubmitBarProps {
  artifactId: string
  projectId: string
  activeRound: ReviewRound | null
  feedbacks: readonly Feedback[]
  onSubmitRound?: (roundId: string) => Promise<unknown>
  onWithdrawRound?: (roundId: string) => Promise<unknown>
}

/**
 * 评审轮次的提交栏：只在评审面板里展示。
 *
 * @remarks 提交轮次会唤醒 Agent；在此之前写下的草稿不会。
 */
export function RoundSubmitBar({
  artifactId,
  projectId,
  activeRound,
  feedbacks,
  onSubmitRound,
  onWithdrawRound,
}: RoundSubmitBarProps) {
  const { t } = useMessages(panelMessages)
  const agentActivity = useWorkspaceStore((s) => s.agentActivityByProject[projectId])
  const submitRoundMutation = useSubmitRoundMutation(artifactId, projectId)
  const withdrawRoundMutation = useWithdrawRoundMutation(artifactId, projectId)

  const summary = summarizeRoundProgress(activeRound, feedbacks)

  const handleSubmit = async () => {
    if (!activeRound) return
    try {
      if (onSubmitRound) {
        await onSubmitRound(activeRound.id)
      } else {
        await submitRoundMutation.mutateAsync(activeRound.id)
      }
      toast.success(t('已提交并通知 Agent'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('提交本轮失败'))
    }
  }

  const handleWithdraw = async () => {
    if (!activeRound) return
    try {
      if (onWithdrawRound) {
        await onWithdrawRound(activeRound.id)
      } else {
        await withdrawRoundMutation.mutateAsync(activeRound.id)
      }
      toast.success(t('已撤回，可继续编辑评审'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('撤回本轮失败'))
    }
  }

  if (isAccessDenied(submitRoundMutation.error) || isAccessDenied(withdrawRoundMutation.error)) {
    return <p role="alert">{t('没有评审权限')}</p>
  }

  if (activeRound?.status === 'drafting') {
    return (
      <div
        data-testid="round-submit-bar"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-amber-50/75 px-4 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="warning">{t('本轮草稿')}</Badge>
          <span className="font-medium text-ink">
            {t('已评审 {done} / {count} 项', {
              done: summary.decidedGroups,
              count: summary.totalGroups,
            })}
          </span>
          <span className="text-ink-muted">
            {t('草稿 {count} 条', { count: summary.draftCommentCount })}
          </span>
          {summary.undecidedWithRecommended > 0 ? (
            <span className="text-amber-800">
              {t('{count} 项可按推荐执行', { count: summary.undecidedWithRecommended })}
            </span>
          ) : null}
        </div>
        <p className="text-ink-muted">{t('提交后通知 Agent。')}</p>

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Send size={13} />}
          loading={submitRoundMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {t('提交本轮')}
        </Button>
      </div>
    )
  }

  if (activeRound?.status === 'submitted') {
    const agentEditing = agentActivity?.state === 'editing'
    return (
      <div
        data-testid="round-submit-bar"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok" icon={<CheckCheck size={12} />}>
            {t('本轮已提交')}
          </Badge>
          <span className="text-ink">
            {agentEditing ? t('Agent 修改中') : t('等待 Agent 处理')}
            {agentEditing && agentActivity.summary && `：${agentActivity.summary}`}
          </span>
          <p className="text-ink-muted">{t('已提交的反馈不会撤回。')}</p>
        </div>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<RotateCcw size={13} />}
          loading={withdrawRoundMutation.isPending}
          onClick={() => void handleWithdraw()}
        >
          {t('撤回本轮')}
        </Button>
      </div>
    )
  }

  return null
}
