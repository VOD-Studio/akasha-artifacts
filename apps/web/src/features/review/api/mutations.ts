import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import { artifactKeys } from '../../../entities/artifact'
import {
  feedbackKeys,
  type RecordHumanDecisionInput,
  recordHumanDecision,
  type SubmitFeedbackInput,
  submitArtifactFeedback,
  submitReviewRound,
  withdrawReviewRound,
} from '../../../entities/feedback'

function invalidateReviewQueries(queryClient: QueryClient, artifactId: string): void {
  // 写入成功后同时刷新反馈与制品详情；不等待重新拉取，避免阻塞提交完成和后续通知。
  void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
  void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
}

/** 保存反馈后异步刷新反馈列表和轮次详情；回执不表示 Agent 已读取。 */
export function useSubmitFeedbackMutation(artifactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) => submitArtifactFeedback(artifactId, input),
    onSuccess: () => invalidateReviewQueries(queryClient, artifactId),
  })
}

/** 写入评审决定；是否提交本轮由 `submitRound` 明确指定。 */
export function useRecordDecisionMutation(artifactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordHumanDecisionInput) => recordHumanDecision(artifactId, input),
    onSuccess: () => invalidateReviewQueries(queryClient, artifactId),
  })
}

/** 提交草拟轮次后刷新反馈与详情，不等待 Agent 回复。 */
export function useSubmitRoundMutation(artifactId: string, projectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roundId: string) => submitReviewRound(artifactId, roundId, projectId),
    onSuccess: () => invalidateReviewQueries(queryClient, artifactId),
  })
}

/** 重新打开轮次；已发布的反馈保留，随后异步刷新反馈与详情。 */
export function useWithdrawRoundMutation(artifactId: string, projectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roundId: string) => withdrawReviewRound(artifactId, roundId, projectId),
    onSuccess: () => invalidateReviewQueries(queryClient, artifactId),
  })
}
