import type { PublicId, ReviewGroup, ReviewRound, Verdict } from '@akasha/protocol'
import { DomainError, NotFoundError, RoundLockedError } from '../errors.js'

/** 新建一个 `drafting` 状态的轮次；`groups` 会被深拷贝，调用方之后的修改不影响轮次。 */
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

/** 把所有未关闭的轮次转为 `closed`，返回新数组；新轮次开启时调用。 */
export function closeActiveRounds(rounds: readonly ReviewRound[]): ReviewRound[] {
  return rounds.map((r) => (r.status === 'closed' ? r : { ...r, status: 'closed' }))
}

/**
 * 把一次选择或裁决写入轮次中的某个分组，返回新轮次，不修改入参。
 *
 * @throws {RoundLockedError} 非 Agent 发起且轮次已不是 `drafting`。
 * @throws {NotFoundError} `groupId` 在轮次中不存在。
 * @throws {DomainError} 向 `verify` 组写 `choice`、向 `choose` 组写 `verdict`，
 * 或 `choice` 不在 `options` 内；错误码为 `BAD_REQUEST`。
 */
export function applyGroupDecision(
  round: ReviewRound,
  params: {
    groupId: string
    // 以下三项不传表示不改；`choice` 传 null 表示清空
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

/** `drafting` 或 `submitted` → `submitted`；已 `closed` 的轮次抛 `RoundLockedError`。 */
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

/** `submitted` → `drafting` 并清空提交时间；其他状态抛 `RoundLockedError`。 */
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
