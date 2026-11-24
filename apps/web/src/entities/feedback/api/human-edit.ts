import type { Version } from '@akasha/protocol'
import { computeLineDiff } from '../../../shared/lib/diff'
import { submitArtifactFeedback } from './client'

function summarizeHumanEdit(
  previousSource: string,
  nextSource: string,
  nextVersion: number,
  origin: 'code' | 'canvas',
): string {
  const diff = computeLineDiff(previousSource, nextSource)
  const added = diff.filter((l) => l.kind === 'added').length
  const removed = diff.filter((l) => l.kind === 'removed').length
  const changedPreview = diff
    .filter((l) => l.kind !== 'context')
    .slice(0, 12)
    .map((l) => `${l.kind === 'added' ? '+' : '-'}${l.text}`)
    .join('\n')
  const editor = origin === 'canvas' ? '在画布' : '在 L3 代码编辑器'
  return `人类${editor}直接保存了 v${nextVersion}（+${added} / -${removed} 行）${
    changedPreview ? `\n${changedPreview}` : ''
  }`
}

/** 反馈指向已落盘的版本；发送失败不把已经提交的版本标记为保存失败。 */
export async function notifyHumanVersionEdit(
  projectId: string,
  version: Version,
  previousSource: string,
  origin: 'code' | 'canvas',
) {
  try {
    await submitArtifactFeedback(version.artifactId, {
      project: projectId,
      version: version.version,
      roundId: null,
      kind: 'edit',
      element: null,
      body: summarizeHumanEdit(previousSource, version.source, version.version, origin),
    })
  } catch {
    // 版本已经落盘，Agent 通知失败不回滚保存。
  }
}
