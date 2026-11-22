import type { Feedback, ReviewRound } from '@akasha/protocol'

// 防打断不变量：落在未提交（drafting）轮次中的批注默认标记为草稿，不触发即时唤醒。
export function isDraftFeedback(round: ReviewRound | undefined): boolean {
  return round?.status === 'drafting'
}

export function shouldNotifyImmediately(feedback: Feedback): boolean {
  return !feedback.draft
}
