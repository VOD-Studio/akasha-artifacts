import { readEditableArtboardSource } from '@akasha/protocol'
import { removeCanvasBoards } from './canvas-edit-source'

/** 对指定制品基准版本中页面的整次变更。 */
export type CanvasPageEdit =
  | { kind: 'create'; id: string; title: string }
  | { kind: 'rename'; id: string; title: string }
  | { kind: 'delete'; id: string }

/** 保留未知源码字段；修改同时固化旧源码中推断出的标识，避免定位链接随改名或删除漂移。 */
export function editCanvasPages(source: string, baseVersion: number, edit: CanvasPageEdit): string {
  const draft = readEditableArtboardSource(source, baseVersion)
  const { raw, pages, boards } = draft
  const entries: unknown[] = Array.isArray(raw.pages) ? raw.pages : []
  const target = pages.get(edit.id)
  if (edit.kind === 'create') {
    if (target) throw new Error('页面标识已存在')
    raw.pages = [...entries, { id: edit.id, title: edit.title, includeSharedBoards: false }]
  } else {
    if (!target) throw new Error('该页面已不存在')
    if (edit.kind === 'rename') {
      target.raw.title = edit.title
    } else {
      raw.pages = entries.filter((entry) => entry !== target.raw)
      const removed = new Set<string>()
      for (const [id, entry] of boards) {
        if (entry.board.pageId === target.page.id) removed.add(id)
      }
      removeCanvasBoards(draft, removed)
    }
  }

  return JSON.stringify(raw, null, 2)
}
