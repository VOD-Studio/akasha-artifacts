import type { JsonPatchOp, StatePatchEntry } from '@akasha/protocol'
import { StatePatchError } from '../errors.js'

function parsePointer(pointer: string): string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) {
    throw new Error(`非法 JSON Pointer "${pointer}"`)
  }
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseArrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (token === '-' && allowEnd) return length
  if (!/^(?:0|[1-9]\d*)$/.test(token)) {
    throw new Error(`非法数组索引 "${token}"`)
  }
  const idx = Number(token)
  const max = allowEnd ? length : length - 1
  if (idx < 0 || idx > max) {
    throw new Error(`数组索引 ${idx} 越界（长度 ${length}）`)
  }
  return idx
}

function getValueAt(root: unknown, tokens: string[]): { exists: boolean; value: unknown } {
  let cur: unknown = root
  for (const token of tokens) {
    if (Array.isArray(cur)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) return { exists: false, value: undefined }
      const idx = Number(token)
      if (idx < 0 || idx >= cur.length) return { exists: false, value: undefined }
      cur = cur[idx]
    } else if (isObjectRecord(cur)) {
      if (!Object.hasOwn(cur, token)) return { exists: false, value: undefined }
      cur = cur[token]
    } else {
      return { exists: false, value: undefined }
    }
  }
  return { exists: true, value: cur }
}

function resolveParent(
  root: unknown,
  tokens: string[],
): { parent: Record<string, unknown> | unknown[]; key: string } {
  if (tokens.length === 0) {
    throw new Error('操作目标不能是根路径')
  }
  let cur: unknown = root
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    if (Array.isArray(cur)) {
      const idx = parseArrayIndex(token, cur.length, false)
      cur = cur[idx]
    } else if (isObjectRecord(cur)) {
      if (!Object.hasOwn(cur, token)) {
        throw new Error(`父路径段 "${token}" 不存在`)
      }
      cur = cur[token]
    } else {
      throw new Error(`父路径段 "${token}" 不是容器对象`)
    }
  }
  if (!Array.isArray(cur) && !isObjectRecord(cur)) {
    throw new Error('目标父节点不是对象或数组')
  }
  const key = tokens[tokens.length - 1]
  if (key === undefined) {
    throw new Error('缺少目标路径键')
  }
  return { parent: cur, key }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  if (isObjectRecord(a) && isObjectRecord(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function applySingleOp(doc: Record<string, unknown>, op: JsonPatchOp): Record<string, unknown> {
  const pathTokens = parsePointer(op.path)

  switch (op.op) {
    case 'add': {
      if (pathTokens.length === 0) {
        if (!isObjectRecord(op.value)) {
          throw new Error('根状态必须为 JSON 对象')
        }
        return structuredClone(op.value)
      }
      const { parent, key } = resolveParent(doc, pathTokens)
      const val = structuredClone(op.value)
      if (Array.isArray(parent)) {
        const idx = parseArrayIndex(key, parent.length, true)
        parent.splice(idx, 0, val)
      } else {
        parent[key] = val
      }
      return doc
    }

    case 'remove': {
      const { parent, key } = resolveParent(doc, pathTokens)
      if (Array.isArray(parent)) {
        const idx = parseArrayIndex(key, parent.length, false)
        parent.splice(idx, 1)
      } else {
        if (!Object.hasOwn(parent, key)) {
          throw new Error(`删除目标 "${op.path}" 不存在`)
        }
        delete parent[key]
      }
      return doc
    }

    case 'replace': {
      if (pathTokens.length === 0) {
        if (!isObjectRecord(op.value)) {
          throw new Error('根状态必须为 JSON 对象')
        }
        return structuredClone(op.value)
      }
      const { parent, key } = resolveParent(doc, pathTokens)
      const val = structuredClone(op.value)
      if (Array.isArray(parent)) {
        const idx = parseArrayIndex(key, parent.length, false)
        parent[idx] = val
      } else {
        if (!Object.hasOwn(parent, key)) {
          throw new Error(`替换目标 "${op.path}" 不存在`)
        }
        parent[key] = val
      }
      return doc
    }

    case 'move': {
      if (op.path === op.from) return doc
      if (op.path.startsWith(`${op.from}/`)) {
        throw new Error(`不能将 "${op.from}" 移动到其自身子路径 "${op.path}"`)
      }
      const fromTokens = parsePointer(op.from)
      const found = getValueAt(doc, fromTokens)
      if (!found.exists) {
        throw new Error(`移动源路径 "${op.from}" 不存在`)
      }
      const afterRemove = applySingleOp(doc, { op: 'remove', path: op.from })
      return applySingleOp(afterRemove, { op: 'add', path: op.path, value: found.value })
    }

    case 'copy': {
      const fromTokens = parsePointer(op.from)
      const found = getValueAt(doc, fromTokens)
      if (!found.exists) {
        throw new Error(`复制源路径 "${op.from}" 不存在`)
      }
      return applySingleOp(doc, { op: 'add', path: op.path, value: found.value })
    }

    case 'test': {
      const found = getValueAt(doc, pathTokens)
      if (!found.exists || !deepEqual(found.value, op.value)) {
        throw new Error(`test 断言失败：路径 "${op.path}" 与预期值不相等`)
      }
      return doc
    }
  }
}

/**
 * 在入参快照的深拷贝上按序应用补丁，返回新快照。
 *
 * @returns 应用了全部补丁的新对象；入参 `snapshot` 不被修改。
 * @throws {StatePatchError} 任一步失败即抛出，`details` 含 `opIndex` 与出错的 `op`。
 */
export function applyJsonPatch(
  snapshot: Readonly<Record<string, unknown>>,
  ops: readonly JsonPatchOp[],
): Record<string, unknown> {
  let working = structuredClone(snapshot) as Record<string, unknown>
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (!op) continue
    try {
      working = applySingleOp(working, op)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new StatePatchError(`补丁第 ${i} 项（${op.op} ${op.path}）失败：${msg}`, {
        opIndex: i,
        op,
      })
    }
  }
  return working
}

/**
 * 从空对象起按 `seq` 顺序回放补丁，得到指定时刻的状态。
 *
 * @param upToSeq - 回放截止的补丁序号（含）；省略时回放全部。
 * @returns `seq` 为最后一条已回放补丁的序号，没有可回放的补丁时为 0。
 *
 * @remarks 不对 `entries` 排序，调用方须按 `seq` 升序传入。
 */
export function replayStateStream(
  entries: readonly StatePatchEntry[],
  upToSeq?: number,
): { seq: number; snapshot: Record<string, unknown> } {
  let snapshot: Record<string, unknown> = {}
  let lastSeq = 0
  for (const entry of entries) {
    if (upToSeq !== undefined && entry.seq > upToSeq) break
    snapshot = applyJsonPatch(snapshot, entry.ops)
    lastSeq = entry.seq
  }
  return { seq: lastSeq, snapshot }
}
