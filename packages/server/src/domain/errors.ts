import type { ErrorCode, JsonPatchOp, VersionConflictDetails } from '@akasha/protocol'

/** 领域层与应用层抛出的业务错误；接口层按 `code` 映射 HTTP 状态码并写入错误信封。 */
export class DomainError extends Error {
  /** 决定 HTTP 状态码与调用方的分支处理。 */
  readonly code: ErrorCode
  /** 随错误信封原样返回的补充信息；形状由各子类约定。 */
  readonly details?: unknown

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

/** 写入声明的 `baseVersion` 落后于头版本；`details` 含两者间的 diff 与期间作者。 */
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

/** 制品、版本或轮次等资源不存在。 */
export class NotFoundError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, details)
  }
}

/** `old_str` 在源码中零匹配；`details` 含出错的编辑下标。 */
export class MatchNotFoundError extends DomainError {
  constructor(oldStr: string, details?: { editIndex: number; sourceLineCount: number }) {
    super(
      'MATCH_NOT_FOUND',
      `增量修改未找到匹配的 old_str：${JSON.stringify(oldStr.slice(0, 80))}`,
      details,
    )
  }
}

/** `old_str` 匹配到多处，须提供更长的上下文；`details` 含各匹配行号。 */
export class AmbiguousMatchError extends DomainError {
  constructor(oldStr: string, details: { editIndex: number; matchCount: number; lines: number[] }) {
    super(
      'AMBIGUOUS_MATCH',
      `增量修改 old_str 匹配到 ${details.matchCount} 处（行 ${details.lines.join(', ')}），须提供更长上下文以唯一匹配`,
      { ...details, preview: oldStr.slice(0, 80) },
    )
  }
}

/** JSON Patch 应用失败；`details` 含 `opIndex` 与出错的 `op`。 */
export class StatePatchError extends DomainError {
  constructor(message: string, details?: { opIndex: number; op: JsonPatchOp }) {
    super('PATCH_FAILED', message, details)
  }
}

/** 轮次已提交或关闭，不可再修改；`details` 含 `roundId` 与当前 `status`。 */
export class RoundLockedError extends DomainError {
  constructor(roundId: string, status: string) {
    super('ROUND_LOCKED', `评审轮次 "${roundId}" 当前状态为 ${status}，不可修改`, {
      roundId,
      status,
    })
  }
}

/** 回执不存在或已被消费。 */
export class InvalidReceiptError extends DomainError {
  constructor(receipt: string) {
    super('INVALID_RECEIPT', `无效或已过期的反馈回执 "${receipt}"`, { receipt })
  }
}
