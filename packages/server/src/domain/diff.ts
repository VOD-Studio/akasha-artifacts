/**
 * 基于 LCS 的行级统一 diff，用于在 409 版本冲突响应中向 Agent 展示人类改动。
 *
 * @returns 统一 diff 文本；`before` 与 `after` 没有差异时返回空串。
 *
 * @remarks 时间与空间均为两侧行数之积。
 */
export function computeUnifiedDiff(
  before: string,
  after: string,
  fromLabel: string,
  toLabel: string,
): string {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const m = a.length
  const n = b.length

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  const get = (row: number, col: number): number => dp[row]?.[col] ?? 0
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i]
    if (!row) continue
    for (let j = n - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? get(i + 1, j + 1) + 1 : Math.max(get(i + 1, j), get(i, j + 1))
    }
  }

  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`]
  let i = 0
  let j = 0
  let hasChanges = false
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      lines.push(` ${a[i]}`)
      i++
      j++
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      lines.push(`-${a[i]}`)
      hasChanges = true
      i++
    } else {
      lines.push(`+${b[j]}`)
      hasChanges = true
      j++
    }
  }
  while (i < m) {
    lines.push(`-${a[i]}`)
    hasChanges = true
    i++
  }
  while (j < n) {
    lines.push(`+${b[j]}`)
    hasChanges = true
    j++
  }

  return hasChanges ? lines.join('\n') : ''
}
