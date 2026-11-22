import type { ReviewGroup } from '@akasha/protocol'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchArtifactFeedback,
  openReviewRound,
  type RecordHumanDecisionInput,
  recordHumanDecision,
  type SubmitFeedbackInput,
  submitArtifactFeedback,
  submitReviewRound,
  withdrawReviewRound,
} from '../../shared/api/client'
import { artifactKeys } from '../artifact/queries'

export const feedbackKeys = {
  all: ['feedback'] as const,
  list: (artifactId: string) => ['feedback', artifactId] as const,
}

export function useArtifactFeedbackQuery(artifactId: string) {
  return useQuery({
    queryKey: feedbackKeys.list(artifactId),
    queryFn: () => fetchArtifactFeedback(artifactId, true),
    enabled: Boolean(artifactId),
    staleTime: 2_000,
  })
}

export function useSubmitFeedbackMutation(artifactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) => submitArtifactFeedback(artifactId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
    },
  })
}

export function useOpenRoundMutation(artifactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { project?: string; groups: ReviewGroup[] }) =>
      openReviewRound(artifactId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
    },
  })
}

export function useSubmitRoundMutation(artifactId: string, projectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roundId: string) => submitReviewRound(artifactId, roundId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
    },
  })
}

export function useWithdrawRoundMutation(artifactId: string, projectId?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (roundId: string) => withdrawReviewRound(artifactId, roundId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
    },
  })
}

export function useRecordDecisionMutation(artifactId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: RecordHumanDecisionInput) => recordHumanDecision(artifactId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: feedbackKeys.list(artifactId) })
      void queryClient.invalidateQueries({ queryKey: artifactKeys.detailPrefix(artifactId) })
    },
  })
}
