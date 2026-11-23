import type { CheckDiagnostic } from '@akasha/protocol'
import type { BlockEntry } from './types.js'

/** 校验块标识是否唯一；每个重复的标识产生一条 `DUPLICATE_BLOCK_ID` 错误诊断。 */
export function validateBlockIds(blocks: readonly BlockEntry[]): CheckDiagnostic[] {
  const firstSeen = new Map<string, BlockEntry>()
  const diagnostics: CheckDiagnostic[] = []
  for (const entry of blocks) {
    const prev = firstSeen.get(entry.blockId)
    if (prev) {
      diagnostics.push({
        severity: 'error',
        code: 'DUPLICATE_BLOCK_ID',
        message: `重复的块标识 "${entry.blockId}"（首次出现于第 ${prev.line} 行）`,
        line: entry.line,
        column: entry.column,
        suggestion: '为每个结构化块分配唯一稳定的 id 或 data-ak-block',
      })
    } else {
      firstSeen.set(entry.blockId, entry)
    }
  }
  return diagnostics
}
