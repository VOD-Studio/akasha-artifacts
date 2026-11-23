import type { EditableArtboardSource } from '@akasha/protocol'

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 移除稳定 ID 指定的画板及其流程端点，不改写其他画板。 */
export function removeCanvasBoards(
  { raw, boards }: EditableArtboardSource,
  ids: ReadonlySet<string>,
) {
  const removed = new Set<RawRecord>()
  for (const id of ids) {
    const entry = boards.get(id)
    if (!entry) throw new Error('要删除的画板已不存在')
    removed.add(entry.raw)
  }
  raw.boards = raw.boards.filter((entry) => !removed.has(entry))
  if (Array.isArray(raw.flows)) {
    raw.flows = raw.flows.filter((entry: unknown) => {
      if (!isRecord(entry) || !('from' in entry) || !('to' in entry)) return true
      return ![entry.from, entry.to].some((id) => typeof id === 'string' && ids.has(id.trim()))
    })
  }
}
