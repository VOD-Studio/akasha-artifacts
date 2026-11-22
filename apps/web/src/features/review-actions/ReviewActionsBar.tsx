import type { ReviewGroup, ReviewRound, Verdict } from '@akasha/protocol'
import { Badge } from '@akasha/ui/badge'
import { Button } from '@akasha/ui/button'
import { Check, CheckCircle2, MinusCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  useRecordDecisionMutation,
  useSubmitFeedbackMutation,
} from '../../entities/feedback/queries'

export interface ReviewActionsBarProps {
  artifactId: string
  projectId: string
  version: number
  activeRound: ReviewRound | null
  onDecisionRecorded?: (groupId: string, payload: { choice?: string; verdict?: Verdict }) => void
}

const VERDICT_OPTIONS: Array<{ value: Verdict; label: string; tone: string }> = [
  { value: 'pass', label: 'Pass', tone: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  { value: 'reject', label: 'Reject', tone: 'border-red-300 bg-red-50 text-red-800' },
  { value: 'waive', label: 'Waive', tone: 'border-amber-300 bg-amber-50 text-amber-800' },
]

// 评审动作区：提供全局批准/请求修改按钮（携带 version），并渲染当前评审轮次的方案单选与 Pass/Reject/Waive 验收项。
export function ReviewActionsBar({
  artifactId,
  projectId,
  version,
  activeRound,
  onDecisionRecorded,
}: ReviewActionsBarProps) {
  const submitFeedback = useSubmitFeedbackMutation(artifactId)
  const recordDecision = useRecordDecisionMutation(artifactId)

  const sendVerdictAction = async (kind: 'approve' | 'request_changes') => {
    try {
      await submitFeedback.mutateAsync({
        project: projectId,
        version,
        roundId: activeRound?.status === 'drafting' ? activeRound.id : null,
        kind,
        element: null,
        body: kind === 'approve' ? `批准 v${version}` : `对 v${version} 请求修改`,
      })
      toast.success(kind === 'approve' ? `已批准 v${version}` : `已提交 v${version} 修改请求`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评审操作失败')
    }
  }

  const handleGroupChoice = async (group: ReviewGroup, choice: string) => {
    if (!activeRound || activeRound.status !== 'drafting') return
    try {
      await recordDecision.mutateAsync({
        project: projectId,
        roundId: activeRound.id,
        groupId: group.id,
        choice,
      })
      onDecisionRecorded?.(group.id, { choice })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存方案选择失败')
    }
  }

  const handleGroupVerdict = async (group: ReviewGroup, verdict: Verdict) => {
    if (!activeRound || activeRound.status !== 'drafting') return
    try {
      await recordDecision.mutateAsync({
        project: projectId,
        roundId: activeRound.id,
        groupId: group.id,
        verdict,
      })
      onDecisionRecorded?.(group.id, { verdict })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存验收裁决失败')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<CheckCircle2 size={13} className="text-emerald-600" />}
          loading={submitFeedback.isPending}
          onClick={() => void sendVerdictAction('approve')}
          className="flex-1"
        >
          批准 v{version}
        </Button>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<XCircle size={13} className="text-amber-600" />}
          loading={submitFeedback.isPending}
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
            <Badge tone={activeRound.status === 'submitted' ? 'ok' : 'warning'}>
              {activeRound.status === 'submitted'
                ? '已提交待处理'
                : activeRound.status === 'closed'
                  ? '已关闭'
                  : '草稿填写中'}
            </Badge>
          </div>

          {activeRound.groups.map((group) => {
            const locked = activeRound.status !== 'drafting'
            return (
              <div
                key={group.id}
                data-testid={`review-group-${group.id}`}
                className="rounded-lg border border-border bg-surface p-2 text-xs"
              >
                <div className="mb-1.5 flex items-center justify-between gap-1">
                  <span className="font-medium text-ink">{group.title}</span>
                  <span className="text-[10px] text-ink-muted">
                    {group.kind === 'choose' ? '方案选择' : '验收核对'}
                  </span>
                </div>

                {group.kind === 'choose' && group.options ? (
                  <div className="flex flex-wrap gap-1.5">
                    {group.options.map((opt) => {
                      const selected = group.choice === opt
                      const isRec = group.recommended === opt
                      return (
                        <button
                          key={opt}
                          type="button"
                          disabled={locked || recordDecision.isPending}
                          onClick={() => void handleGroupChoice(group, opt)}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${
                            selected
                              ? 'border-violet-600 bg-violet-50 font-semibold text-violet-900'
                              : 'border-border bg-surface text-ink hover:bg-muted'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {selected ? <Check size={11} /> : null}
                          <span>{opt}</span>
                          {isRec ? (
                            <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">
                              推荐
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {group.kind === 'verify' ? (
                  <div className="flex items-center gap-1.5">
                    {VERDICT_OPTIONS.map((v) => {
                      const active = group.verdict === v.value
                      return (
                        <button
                          key={v.value}
                          type="button"
                          disabled={locked || recordDecision.isPending}
                          onClick={() => void handleGroupVerdict(group, v.value)}
                          className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                            active
                              ? v.tone
                              : 'border-border bg-surface text-ink-muted hover:text-ink'
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          {v.value === 'pass' ? (
                            <CheckCircle2 size={11} />
                          ) : v.value === 'reject' ? (
                            <XCircle size={11} />
                          ) : (
                            <MinusCircle size={11} />
                          )}
                          {v.label}
                        </button>
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
