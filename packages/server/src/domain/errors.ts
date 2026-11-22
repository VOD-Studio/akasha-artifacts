import type { ErrorCode, JsonPatchOp, VersionConflictDetails } from '@akasha/protocol'

export class DomainError extends Error {
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

export class VersionConflictError extends DomainError {
  override readonly details: VersionConflictDetails

  constructor(details: VersionConflictDetails) {
    super(
      'VERSION_CONFLICT',
      `版本冲突：基于 v${details.baseVersion} 的写入落后于当前最新版本 v${details.headVersion}`,
      details,
    )
    this.details = details
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, details)
  }
}

export class MatchNotFoundError extends DomainError {
  constructor(oldStr: string, details?: { editIndex: number; sourceLineCount: number }) {
    super(
      'MATCH_NOT_FOUND',
      `增量修改未找到匹配的 old_str：${JSON.stringify(oldStr.slice(0, 80))}`,
      details,
    )
  }
}

export class AmbiguousMatchError extends DomainError {
  constructor(oldStr: string, details: { editIndex: number; matchCount: number; lines: number[] }) {
    super(
      'AMBIGUOUS_MATCH',
      `增量修改 old_str 匹配到 ${details.matchCount} 处（行 ${details.lines.join(', ')}），须提供更长上下文以唯一匹配`,
      { ...details, preview: oldStr.slice(0, 80) },
    )
  }
}

export class StatePatchError extends DomainError {
  constructor(message: string, details?: { opIndex: number; op: JsonPatchOp }) {
    super('PATCH_FAILED', message, details)
  }
}

export class RoundLockedError extends DomainError {
  constructor(roundId: string, status: string) {
    super('ROUND_LOCKED', `评审轮次 "${roundId}" 当前状态为 ${status}，不可修改`, {
      roundId,
      status,
    })
  }
}

export class InvalidReceiptError extends DomainError {
  constructor(receipt: string) {
    super('INVALID_RECEIPT', `无效或已过期的反馈回执 "${receipt}"`, { receipt })
  }
}
