import type { PublicId, ReviewGroup, ReviewRound, Verdict } from '@akasha/protocol'
import { DomainError, NotFoundError, RoundLockedError } from '../errors.js'

export function createReviewRound(params: {
  id: string
  artifactId: PublicId
  groups: ReviewGroup[]
  createdAt: string
}): ReviewRound {
  return {
    id: params.id,
    artifactId: params.artifactId,
    status: 'drafting',
    groups: structuredClone(params.groups),
    submittedAt: null,
    createdAt: params.createdAt,
  }
}

// 新轮次开启时，此前未关闭的旧轮次自动转入 closed，避免旧草稿长期悬挂。
export function closeActiveRounds(rounds: readonly ReviewRound[]): ReviewRound[] {
  return rounds.map((r) => (r.status === 'closed' ? r : { ...r, status: 'closed' }))
}

export function applyGroupDecision(
  round: ReviewRound,
  params: {
    groupId: string
    choice?: string | null
    verdict?: Verdict
    note?: string
    // Agent 回写终端口头答复时可跨越草稿锁定检查；人工网页操作严格要求 drafting 状态
    fromAgent?: boolean
  },
): ReviewRound {
  if (!params.fromAgent && round.status !== 'drafting') {
    throw new RoundLockedError(round.id, round.status)
  }
  const idx = round.groups.findIndex((g) => g.id === params.groupId)
  const group = round.groups[idx]
  if (idx === -1 || !group) {
    throw new NotFoundError(`轮次 "${round.id}" 中不存在分组 "${params.groupId}"`)
  }
  const nextGroup: ReviewGroup = { ...group }

  if (params.choice !== undefined) {
    if (group.kind !== 'choose') {
      throw new DomainError('BAD_REQUEST', `分组 "${group.id}" 不是选择组`)
    }
    if (params.choice !== null && group.options && !group.options.includes(params.choice)) {
      throw new DomainError('BAD_REQUEST', `选项 "${params.choice}" 不属于分组 "${group.id}"`)
    }
    nextGroup.choice = params.choice
  }

  if (params.verdict !== undefined) {
    if (group.kind !== 'verify') {
      throw new DomainError('BAD_REQUEST', `分组 "${group.id}" 不是验收组`)
    }
    nextGroup.verdict = params.verdict
  }

  if (params.note !== undefined) {
    nextGroup.note = params.note
  }

  const nextGroups = round.groups.slice()
  nextGroups[idx] = nextGroup
  return { ...round, groups: nextGroups }
}

export function submitReviewRound(round: ReviewRound, submittedAt: string): ReviewRound {
  if (round.status === 'closed') {
    throw new RoundLockedError(round.id, round.status)
  }
  return {
    ...round,
    status: 'submitted',
    submittedAt,
  }
}

export function withdrawReviewRound(round: ReviewRound): ReviewRound {
  if (round.status !== 'submitted') {
    throw new RoundLockedError(round.id, round.status)
  }
  return {
    ...round,
    status: 'drafting',
    submittedAt: null,
  }
}
