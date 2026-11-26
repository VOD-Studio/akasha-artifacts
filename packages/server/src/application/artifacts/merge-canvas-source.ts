import { parseArtboardValue } from '@akasha/protocol'
import { DomainError } from '../../domain/errors.js'

type Fields = Record<string, unknown>
type Collection = 'pages' | 'boards' | 'designLayers'

function conflict(): never {
  throw new DomainError('VERSION_CONFLICT', '此处已有其他改动。请保留草稿，在最新画布上重新选择。')
}

function unsupported(): never {
  throw new DomainError(
    'RESOURCE_CONFLICT',
    '无法安全合并此设计。请检查画板、页面和图层的标识与结构。',
  )
}

function record(value: unknown): value is Fields {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function own(value: Fields, key: string) {
  return Object.hasOwn(value, key) ? value[key] : undefined
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equal(item, b[index]))
  }
  if (!record(a) || !record(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => equal(a[key], own(b, key)))
}

function index(items: unknown): Map<string, Fields> {
  if (!Array.isArray(items)) return unsupported()
  const result = new Map<string, Fields>()
  for (const item of items) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || item.id.trim() !== item.id)
      return unsupported()
    if (result.has(item.id)) return unsupported()
    result.set(item.id, item)
  }
  return result
}

function validate(value: unknown): Fields {
  if (!record(value)) return unsupported()
  const parsed = parseArtboardValue(value)
  if (!parsed.ok) return unsupported()
  const boards = index(value.boards)
  const pages = index(value.pages === undefined ? [] : value.pages)
  for (const normalized of parsed.data.boards) {
    const board = boards.get(normalized.id)
    if (!board) return unsupported()
    if (board.viewport !== undefined && !normalized.viewport) return unsupported()
    if (board.position !== undefined && !normalized.position) return unsupported()
    if (
      board.pageId !== undefined &&
      board.pageId !== '' &&
      (typeof board.pageId !== 'string' || !pages.has(board.pageId))
    )
      return unsupported()
  }
  if (value.flows !== undefined) {
    if (!Array.isArray(value.flows)) return unsupported()
    for (const flow of value.flows) {
      if (
        !record(flow) ||
        typeof flow.from !== 'string' ||
        typeof flow.to !== 'string' ||
        !boards.has(flow.from) ||
        !boards.has(flow.to)
      )
        return unsupported()
    }
  }
  return value
}

function read(source: string) {
  try {
    return validate(JSON.parse(source))
  } catch {
    return unsupported()
  }
}

function mergeFields(
  base: Fields,
  head: Fields,
  draft: Fields,
  scope: 'document' | Collection | 'field',
) {
  // 设计扩展可使用任意 JSON 键，包括 __proto__；不让其影响普通对象原型。
  const merged: Fields = Object.create(null)
  const keys = new Set([...Object.keys(head), ...Object.keys(draft)])
  for (const key of keys) {
    const b = own(base, key)
    const h = own(head, key)
    const d = own(draft, key)
    let value: unknown
    if (equal(d, b) || equal(h, d)) value = h
    else if (equal(h, b)) value = d
    else if (
      (scope === 'document' && (key === 'boards' || key === 'pages')) ||
      (scope === 'boards' && key === 'designLayers')
    ) {
      if (!Array.isArray(h) || !Array.isArray(d)) return conflict()
      value = mergeCollection(b ?? [], h, d, key)
    } else if (
      scope === 'boards' &&
      ['viewport', 'position', 'appearance', 'presentation'].includes(key) &&
      (b === undefined || record(b)) &&
      record(h) &&
      record(d)
    ) {
      value = mergeFields(b ?? {}, h, d, 'field')
    } else return conflict()
    if (value !== undefined) merged[key] = value
  }
  return merged
}

function mergeCollection(base: unknown, head: unknown, draft: unknown, scope: Collection) {
  const b = index(base)
  const h = index(head)
  const d = index(draft)
  const baseOrder = [...b.keys()]
  const headOrder = [...h.keys()]
  const draftOrder = [...d.keys()]
  let order = headOrder
  if (equal(headOrder, baseOrder)) order = draftOrder
  else if (!equal(draftOrder, baseOrder) && !equal(headOrder, draftOrder)) {
    // 两边都改了成员时，只合并保持原有相对顺序的删除/末尾追加；不同重排由用户选择。
    const appendOnly = (ids: string[], entries: Map<string, Fields>) =>
      equal(ids, [...baseOrder.filter((id) => entries.has(id)), ...ids.filter((id) => !b.has(id))])
    if (!appendOnly(headOrder, h) || !appendOnly(draftOrder, d)) return conflict()
    order = [...headOrder, ...draftOrder.filter((id) => !h.has(id))]
  }
  const items = new Map<string, Fields>()
  // 即便 ID 已从两种顺序之一消失，也要先检查删除是否撞到对方对原对象的修改。
  for (const id of new Set([...headOrder, ...draftOrder])) {
    const old = b.get(id)
    const current = h.get(id)
    const next = d.get(id)
    if (equal(next, old) || equal(current, next)) {
      if (current) items.set(id, current)
    } else if (equal(current, old)) {
      if (next) items.set(id, next)
    } else if (old && current && next) {
      if (scope === 'designLayers' && (current.kind !== old.kind || next.kind !== old.kind))
        return conflict()
      items.set(id, mergeFields(old, current, next, scope))
    } else return conflict()
  }
  return order.flatMap((id) => items.get(id) ?? [])
}

/** 以服务器不可变版本为基准；只有已标识的画板、页面及原生图层可按对象合并。 */
export function mergeCanvasSource(
  baseSource: string,
  headSource: string,
  draftSource: string,
): string {
  const base = read(baseSource)
  const draft = read(draftSource)
  if (headSource === baseSource) return draftSource
  const head = read(headSource)
  const merged = validate(mergeFields(base, head, draft, 'document'))
  return equal(merged, head) ? headSource : JSON.stringify(merged, null, 2)
}
