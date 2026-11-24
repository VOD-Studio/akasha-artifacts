import type { ReviewGroup, ReviewRound, Verdict } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Check, CheckCircle2, type LucideIcon, MinusCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useRecordDecisionMutation, useSubmitFeedbackMutation } from '../api/mutations'

export interface ReviewActionsBarProps {
  artifactId: string
  projectId: string
  version: number
  activeRound: ReviewRound | null
  onDecisionRecorded?: (groupId: string, payload: { choice?: string; verdict?: Verdict }) => void
}

const VERDICT_OPTIONS: ReadonlyArray<{
  value: Verdict
  label: string
  icon: LucideIcon
}> = [
  { value: 'pass', label: 'Pass', icon: CheckCircle2 },
  { value: 'reject', label: 'Reject', icon: XCircle },
  { value: 'waive', label: 'Waive', icon: MinusCircle },
]

const ROUND_STATUS_LABEL: Record<ReviewRound['status'], string> = {
  drafting: '草稿',
  submitted: '已提交',
  closed: '已关闭',
}

function roundStatusTone(status: ReviewRound['status']) {
  if (status === 'drafting') return 'warning'
  if (status === 'submitted') return 'ok'
  return 'neutral'
}

/**
 * 评审动作区：提供全局的批准与请求修改按钮（都带上当前版本号），
 * 并渲染当前评审轮次里的方案单选与 Pass / Reject / Waive 验收项。
 */
export function ReviewActionsBar({
  artifactId,
  projectId,
  version,
  activeRound,
  onDecisionRecorded,
}: ReviewActionsBarProps) {
  const submitFeedback = useSubmitFeedbackMutation(artifactId)
  const recordDecision = useRecordDecisionMutation(artifactId)
  const draftingRound = activeRound?.status === 'drafting' ? activeRound : null
  const feedbackKind = submitFeedback.variables?.kind
  const decision = recordDecision.variables

  const sendVerdictAction = async (kind: 'approve' | 'request_changes') => {
    try {
      await submitFeedback.mutateAsync({
        project: projectId,
        version,
        roundId: draftingRound?.id ?? null,
        kind,
        element: null,
        body: kind === 'approve' ? `批准 v${version}` : `对 v${version} 请求修改`,
      })
      if (draftingRound) {
        toast.success('已保存草稿')
      } else {
        toast.success(kind === 'approve' ? `已批准 v${version}` : '已请求修改')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评审操作失败')
    }
  }

  const handleGroupChoice = async (group: ReviewGroup, choice: string) => {
    if (!draftingRound) return
    try {
      await recordDecision.mutateAsync({
        project: projectId,
        roundId: draftingRound.id,
        groupId: group.id,
        choice,
      })
      onDecisionRecorded?.(group.id, { choice })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存方案选择失败')
    }
  }

  const handleGroupVerdict = async (group: ReviewGroup, verdict: Verdict) => {
    if (!draftingRound) return
    try {
      await recordDecision.mutateAsync({
        project: projectId,
        roundId: draftingRound.id,
        groupId: group.id,
        verdict,
      })
      onDecisionRecorded?.(group.id, { verdict })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存验收结果失败')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<CheckCircle2 size={13} className="text-emerald-600" />}
          disabled={submitFeedback.isPending}
          loading={submitFeedback.isPending && feedbackKind === 'approve'}
          onClick={() => void sendVerdictAction('approve')}
          className="flex-1"
        >
          批准 v{version}
        </Button>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<XCircle size={13} className="text-amber-600" />}
          disabled={submitFeedback.isPending}
          loading={submitFeedback.isPending && feedbackKind === 'request_changes'}
          onClick={() => void sendVerdictAction('request_changes')}
          className="flex-1"
        >
          请求修改
        </Button>
      </div>

      {activeRound && activeRound.groups.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-border bg-surface-subtle p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-ink">本轮评审项</span>
            <Badge tone={roundStatusTone(activeRound.status)}>
              {ROUND_STATUS_LABEL[activeRound.status]}
            </Badge>
          </div>

          {activeRound.groups.map((group) => {
            const locked = !draftingRound
            const updating = recordDecision.isPending && decision?.groupId === group.id
            return (
              <div
                key={group.id}
                data-testid={`review-group-${group.id}`}
                className="rounded-lg border border-border bg-surface p-2 text-xs"
              >
                <div className="mb-1.5 flex items-center justify-between gap-1">
                  <span className="font-medium text-ink">{group.title}</span>
                  <span className="text-[10px] text-ink-muted">
                    {group.kind === 'choose' ? '方案选择' : '验收'}
                  </span>
                </div>

                {group.kind === 'choose' && group.options ? (
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((opt) => {
                      const selected = group.choice === opt
                      const isRec = group.recommended === opt
                      return (
                        <Button
                          key={opt}
                          size="sm"
                          variant={selected ? 'primary' : 'outline'}
                          aria-pressed={selected}
                          disabled={locked || recordDecision.isPending}
                          loading={updating && decision?.choice === opt}
                          leftIcon={selected ? <Check size={11} /> : undefined}
                          onClick={() => void handleGroupChoice(group, opt)}
                        >
                          <span>{opt}</span>
                          {isRec && <Badge tone="neutral">推荐</Badge>}
                        </Button>
                      )
                    })}
                  </div>
                ) : null}

                {group.kind === 'verify' ? (
                  <div className="flex items-center gap-1.5">
                    {VERDICT_OPTIONS.map(({ value, label, icon: Icon }) => {
                      const active = group.verdict === value
                      return (
                        <Button
                          key={value}
                          size="sm"
                          variant={active ? 'primary' : 'outline'}
                          aria-pressed={active}
                          disabled={locked || recordDecision.isPending}
                          loading={updating && decision?.verdict === value}
                          leftIcon={<Icon size={11} />}
                          onClick={() => void handleGroupVerdict(group, value)}
                          className="flex-1"
                        >
                          {label}
                        </Button>
                      )
                    })}
                  </div>
                ) : null}

                {group.note ? (
                  <p className="mt-1.5 text-[11px] text-ink-muted">备注：{group.note}</p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
