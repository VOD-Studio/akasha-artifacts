import type { CatalogCorrection, CatalogRecovery } from '@akasha/protocol'
import { reconcileCatalogModel } from './catalog-model.js'
import { type CatalogBoardSource, catalogRegions } from './catalog-regions.js'

/** 行号属于提交的候选稿，而非固定系统或修正后的独立源码。 */
export type CatalogReconciliation =
  | { ok: true; source: string; corrections: CatalogCorrection[] }
  | ({ ok: false } & Pick<CatalogRecovery, 'reason' | 'line'>)

function firstDifference(source: string, at: number, expected: string) {
  let i = 0
  while (i < expected.length && source[at + i] === expected[i]) i++
  return at + i
}

function titleEnd(source: string, at: number) {
  if (source[at] !== '"') return -1
  for (let i = at + 1; i < source.length; i++) {
    if (source[i] === '"') return i + 1
    if (source[i] === '\n' || source[i] === '\r') break
    if (source[i] === '\\') i++
  }
  return -1
}

/** 只接受固定骨架、带边界的受管实现及纯 JSON 业务数据；从不加载或执行候选模块。 */
export function reconcileCatalogCandidate(
  expected: CatalogBoardSource,
  candidateSource: string,
): CatalogReconciliation {
  const original = expected.source
  if (candidateSource === original) return { ok: true, source: candidateSource, corrections: [] }
  const regions = expected[catalogRegions]
  const corrections: CatalogCorrection[] = []
  const edits: { start: number; end: number; source: string }[] = []
  const failure = (reason: CatalogRecovery['reason'], at: number): CatalogReconciliation => {
    let line = 1
    for (let i = 0; i < at; i++) {
      if (
        candidateSource[i] === '\n' ||
        (candidateSource[i] === '\r' && candidateSource[i + 1] !== '\n')
      )
        line++
    }
    return { ok: false, reason, line }
  }
  let cursor = 0
  let previous = 0
  for (const region of regions) {
    const fixed = original.slice(previous, region.start)
    if (!candidateSource.startsWith(fixed, cursor))
      return failure('structure', firstDifference(candidateSource, cursor, fixed))
    cursor += fixed.length
    const start = cursor
    const trusted = original.slice(region.start, region.end)
    previous = region.end
    if (region.kind === 'reference') {
      if (!candidateSource.startsWith(trusted, cursor)) return failure('reference', cursor)
      cursor += trusted.length
    } else if (region.kind === 'component') {
      if (
        candidateSource.startsWith(trusted, cursor) &&
        candidateSource.startsWith(region.close, cursor + trusted.length)
      ) {
        cursor += trusted.length
        continue
      }
      const close = candidateSource.indexOf('\n/* @akasha/catalog-slot ', cursor)
      if (close < 0 || !candidateSource.startsWith(region.close, close)) {
        const offset =
          close < 0 ? firstDifference(candidateSource, cursor, trusted + region.close) : close + 1
        return failure('instance', offset)
      }
      const module = candidateSource.slice(start, close)
      if (!module.trim() || module.startsWith(trusted) || module.endsWith(trusted))
        return failure('instance', firstDifference(candidateSource, cursor, trusted))
      // 未改标记却粘入另一个已知槽位的整份模块时，不能替作者决定应保留哪个来源。
      for (const other of regions) {
        if (
          other.kind !== 'component' ||
          other === region ||
          other.end - other.start !== module.length
        )
          continue
        if (original.startsWith(module, other.start)) return failure('reference', start)
      }
      const { id, version, components } = region.reference
      corrections.push({ kind: 'component', id, version, component: components[region.index] })
      edits.push({ start, end: close, source: trusted })
      cursor = close
    } else if (region.kind === 'model') {
      const lineEnd = candidateSource.indexOf('\n', start)
      if (lineEnd < 0 || candidateSource[lineEnd - 1] !== ';') return failure('instance', start)
      cursor = lineEnd - 1
      const data = candidateSource.slice(start, cursor)
      if (data === trusted) continue
      const result = reconcileCatalogModel(trusted, data)
      if ('reason' in result) return failure(result.reason, start)
      if (result.corrected) {
        const { id, version } = region.reference
        corrections.push({ kind: 'guidance', id, version })
      }
      if (result.source !== data) edits.push({ start, end: cursor, source: result.source })
    } else {
      cursor = titleEnd(candidateSource, start)
      if (cursor < 0) return failure('structure', start)
      let title: unknown
      try {
        title = JSON.parse(candidateSource.slice(start, cursor))
      } catch {
        return failure('structure', start)
      }
      if (typeof title !== 'string') return failure('structure', start)
      const encoded = JSON.stringify(title)
      if (encoded !== candidateSource.slice(start, cursor))
        edits.push({ start, end: cursor, source: encoded })
    }
  }
  const tail = original.slice(previous)
  if (!candidateSource.startsWith(tail, cursor))
    return failure('structure', firstDifference(candidateSource, cursor, tail))
  cursor += tail.length
  if (cursor !== candidateSource.length) {
    const at = cursor
    while (cursor < candidateSource.length && /\s/.test(candidateSource[cursor])) cursor++
    return failure('structure', cursor < candidateSource.length ? cursor : at)
  }
  if (!edits.length) return { ok: true, source: candidateSource, corrections }
  let source = ''
  let end = 0
  for (const edit of edits) {
    source += candidateSource.slice(end, edit.start) + edit.source
    end = edit.end
  }
  return { ok: true, source: source + candidateSource.slice(end), corrections }
}
