import type { Feedback, ReviewRound } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { CheckCheck, RotateCcw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useSubmitRoundMutation, useWithdrawRoundMutation } from '../../entities/feedback/queries'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { summarizeRoundProgress } from '../../features/review-rounds/round-utils'

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
      toast.success('已打包提交本轮评审并通知 Agent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交本轮失败')
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
      toast.success('已撤回本轮评审，恢复为草稿编辑状态')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '撤回本轮失败')
    }
  }

  if (activeRound?.status === 'drafting') {
    return (
      <div
        data-testid="round-submit-bar"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-amber-200 bg-amber-50/75 px-4 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge tone="warning">评审草稿轮次</Badge>
          <span className="font-medium text-ink">
            已决策 {summary.decidedGroups} / {summary.totalGroups}
          </span>
          <span className="text-ink-muted">草稿评论 {summary.draftCommentCount} 条</span>
          {summary.undecidedWithRecommended > 0 ? (
            <span className="text-amber-800">
              （其余 {summary.undecidedWithRecommended} 项可按推荐执行）
            </span>
          ) : null}
        </div>

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Send size={13} />}
          loading={submitRoundMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          提交本轮
        </Button>
      </div>
    )
  }

  if (activeRound?.status === 'submitted') {
    return (
      <div
        data-testid="round-submit-bar"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-xs"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok" icon={<CheckCheck size={12} />}>
            本轮已提交
          </Badge>
          <span className="text-ink">
            {agentActivity?.state === 'editing'
              ? `Agent 正在按本轮反馈修改${agentActivity.summary ? `：${agentActivity.summary}` : '…'}`
              : '已打包送达，等待 Agent 拉取并处理'}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          leftIcon={<RotateCcw size={13} />}
          loading={withdrawRoundMutation.isPending}
          onClick={() => void handleWithdraw()}
        >
          撤回修改
        </Button>
      </div>
    )
  }

  return null
}
