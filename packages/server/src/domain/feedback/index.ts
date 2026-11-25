import { type Feedback, isAnnotationKind, type ReviewRound } from '@akasha/protocol'

/** 落在未提交（`drafting`）轮次中的批注是草稿：照常持久化与展示，但不触发即时唤醒。 */
export function isDraftFeedback(round: ReviewRound | undefined): boolean {
  return round?.status === 'drafting'
}

/** 只有非草稿且可投递的反馈才即时唤醒 Agent。 */
export function shouldNotifyImmediately(feedback: Feedback): boolean {
  return !feedback.draft && feedback.audience !== 'human'
}

/** 只有非草稿、明确面向 Agent 且非受邀分享访客的批注才投递给本机已绑定 Agent 会话。 */
export function shouldDispatchToBoundAgent(feedback: Feedback): boolean {
  return (
    !feedback.draft &&
    isAnnotationKind(feedback.kind) &&
    (feedback.audience === 'agent' || feedback.kind === 'request_changes') &&
    feedback.author.startsWith('human:') &&
    feedback.author !== 'human:share'
  )
}
