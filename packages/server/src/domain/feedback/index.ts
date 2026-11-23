import type { Feedback, ReviewRound } from '@akasha/protocol'

/** 落在未提交（`drafting`）轮次中的批注是草稿：照常持久化与展示，但不触发即时唤醒。 */
export function isDraftFeedback(round: ReviewRound | undefined): boolean {
  return round?.status === 'drafting'
}

/** 非草稿反馈才即时唤醒 Agent。 */
export function shouldNotifyImmediately(feedback: Feedback): boolean {
  return !feedback.draft
}
