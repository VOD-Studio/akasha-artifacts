import type { Artifact, Author, PublicId, TextEdit, Version } from '@akasha/protocol'
import { computeUnifiedDiff } from '../diff.js'
import {
  AmbiguousMatchError,
  DomainError,
  MatchNotFoundError,
  VersionConflictError,
} from '../errors.js'
import { deepFreeze } from '../freeze.js'

function lineNumberAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) line++
  }
  return line
}

// 增量替换契约：每条 old_str 必须在当前源码中精确匹配且仅匹配一次，任一步失败则整体不生效。
export function applyTextEdits(source: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) {
    throw new DomainError('BAD_REQUEST', 'edits 不能为空')
  }
  let current = source
  for (let idx = 0; idx < edits.length; idx++) {
    const edit = edits[idx]
    if (!edit) continue
    if (edit.old_str.length === 0) {
      throw new DomainError('BAD_REQUEST', `第 ${idx} 条编辑的 old_str 不能为空`)
    }
    const positions: number[] = []
    let start = 0
    while (start <= current.length) {
      const pos = current.indexOf(edit.old_str, start)
      if (pos === -1) break
      positions.push(pos)
      start = pos + 1
    }
    if (positions.length === 0) {
      throw new MatchNotFoundError(edit.old_str, {
        editIndex: idx,
        sourceLineCount: current === '' ? 0 : current.split('\n').length,
      })
    }
    if (positions.length > 1) {
      throw new AmbiguousMatchError(edit.old_str, {
        editIndex: idx,
        matchCount: positions.length,
        lines: positions.map((p) => lineNumberAt(current, p)),
      })
    }
    const pos = positions[0]
    if (pos === undefined) continue
    current = current.slice(0, pos) + edit.new_str + current.slice(pos + edit.old_str.length)
  }
  return current
}

export function createImmutableVersion(params: {
  artifactId: PublicId
  version: number
  parentVersion: number | null
  author: Author
  title: string
  source: string
  createdAt: string
}): Readonly<Version> {
  return deepFreeze({
    artifactId: params.artifactId,
    version: params.version,
    parentVersion: params.parentVersion,
    author: params.author,
    title: params.title,
    source: params.source,
    createdAt: params.createdAt,
  })
}

// 并发写入不变量：针对已有 Artifact 的任何写入都须声明 baseVersion，落后于 headVersion 时抛出 409 并附带差异。
export function assertBaseVersion(
  artifact: Artifact,
  versions: readonly Version[],
  baseVersion: number | undefined,
): void {
  if (baseVersion === undefined) {
    throw new DomainError(
      'BAD_REQUEST',
      `Artifact "${artifact.slug}" 已存在（v${artifact.headVersion}），更新时必须提供 baseVersion`,
    )
  }
  if (baseVersion === artifact.headVersion) {
    return
  }
  const baseRecord = versions.find((v) => v.version === baseVersion)
  const headRecord = versions.find((v) => v.version === artifact.headVersion)
  const baseSource = baseRecord?.source ?? ''
  const headSource = headRecord?.source ?? ''
  const diff = computeUnifiedDiff(
    baseSource,
    headSource,
    `v${baseVersion}`,
    `v${artifact.headVersion}`,
  )
  const authors = Array.from(
    new Set(
      versions
        .filter((v) => v.version > baseVersion && v.version <= artifact.headVersion)
        .map((v) => v.author),
    ),
  )
  throw new VersionConflictError({
    artifactId: artifact.publicId,
    baseVersion,
    headVersion: artifact.headVersion,
    diff,
    authors,
  })
}
