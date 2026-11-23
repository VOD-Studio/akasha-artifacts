export interface DiffLine {
  kind: 'context' | 'added' | 'removed'
  oldLine: number | null
  newLine: number | null
  text: string
}

/** 行级 LCS diff：供版本对比视图高亮两版源码里新增与删除的行。 */
export function computeLineDiff(before: string, after: string): DiffLine[] {
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

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', oldLine: i + 1, newLine: j + 1, text: a[i] ?? '' })
      i++
      j++
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      out.push({ kind: 'removed', oldLine: i + 1, newLine: null, text: a[i] ?? '' })
      i++
    } else {
      out.push({ kind: 'added', oldLine: null, newLine: j + 1, text: b[j] ?? '' })
      j++
    }
  }
  while (i < m) {
    out.push({ kind: 'removed', oldLine: i + 1, newLine: null, text: a[i] ?? '' })
    i++
  }
  while (j < n) {
    out.push({ kind: 'added', oldLine: null, newLine: j + 1, text: b[j] ?? '' })
    j++
  }
  return out
}
