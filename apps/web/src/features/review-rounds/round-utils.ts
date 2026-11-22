import type { Feedback, ReviewRound } from '@akasha/protocol'

export interface RoundProgressSummary {
  totalGroups: number
  decidedGroups: number
  undecidedWithRecommended: number
  draftCommentCount: number
}

// 汇总当前活跃评审轮次的决策进度与草稿评论数量，供底部提交栏与防打断提示展示。
export function summarizeRoundProgress(
  round: ReviewRound | null,
  feedbacks: readonly Feedback[],
): RoundProgressSummary {
  if (!round) {
    return {
      totalGroups: 0,
      decidedGroups: 0,
      undecidedWithRecommended: 0,
      draftCommentCount: 0,
    }
  }

  let decidedGroups = 0
  let undecidedWithRecommended = 0
  for (const g of round.groups) {
    const decided = g.kind === 'choose' ? Boolean(g.choice) : Boolean(g.verdict)
    if (decided) {
      decidedGroups++
    } else if (g.recommended) {
      undecidedWithRecommended++
    }
  }

  const draftCommentCount = feedbacks.filter((fb) => fb.roundId === round.id && fb.draft).length

  return {
    totalGroups: round.groups.length,
    decidedGroups,
    undecidedWithRecommended,
    draftCommentCount,
  }
}

export function selectActiveRound(rounds: readonly ReviewRound[]): ReviewRound | null {
  const drafting = [...rounds].reverse().find((r) => r.status === 'drafting')
  if (drafting) return drafting
  const submitted = [...rounds].reverse().find((r) => r.status === 'submitted')
  return submitted ?? null
}
