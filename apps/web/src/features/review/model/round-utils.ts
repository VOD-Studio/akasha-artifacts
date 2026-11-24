import type { Feedback, ReviewRound } from '@akasha/protocol'

/** 活跃评审轮次的进度摘要。 */
export interface RoundProgressSummary {
  /** 轮次里的分组总数。 */
  totalGroups: number
  /** 已做出选择的分组数。 */
  decidedGroups: number
  /** 未做选择、但 Agent 给了推荐项的分组数。 */
  undecidedWithRecommended: number
  /** 该轮次下仍是草稿的评论数。 */
  draftCommentCount: number
}

/**
 * 汇总一轮的决策进度与草稿评论数，供底部提交栏与防打断提示使用。
 *
 * @returns 没有轮次时各项为 0。
 */
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

/**
 * 选出当前活跃的轮次：优先最新的 `drafting`，其次是最新的 `submitted`。
 *
 * @returns 没有未关闭的轮次时返回 `null`。
 */
export function selectActiveRound(rounds: readonly ReviewRound[]): ReviewRound | null {
  const drafting = [...rounds].reverse().find((r) => r.status === 'drafting')
  if (drafting) return drafting
  const submitted = [...rounds].reverse().find((r) => r.status === 'submitted')
  return submitted ?? null
}
