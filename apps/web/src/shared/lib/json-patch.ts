import type { JsonPatchOp } from '@akasha/protocol'

function parsePointer(pointer: string): string[] {
  if (pointer === '') return []
  if (!pointer.startsWith('/')) throw new Error(`非法 JSON Pointer: ${pointer}`)
  return pointer
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveParent(
  root: unknown,
  tokens: string[],
): { parent: Record<string, unknown> | unknown[]; key: string } | null {
  if (tokens.length === 0) return null
  let cur: unknown = root
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    if (token === undefined) return null
    if (Array.isArray(cur)) {
      const idx = Number(token)
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return null
      cur = cur[idx]
    } else if (isObjectRecord(cur) && Object.hasOwn(cur, token)) {
      cur = cur[token]
    } else {
      return null
    }
  }
  if (!Array.isArray(cur) && !isObjectRecord(cur)) return null
  const key = tokens[tokens.length - 1]
  if (key === undefined) return null
  return { parent: cur, key }
}

/**
 * 在快照的深拷贝上应用补丁，用于把 `state.patched` 的增量同步到查询缓存里的状态快照。
 *
 * @remarks 与服务端不同：路径解析不到的单条操作被跳过，而不是让整批补丁失败。
 */
export function applyJsonPatchClient(
  snapshot: Readonly<Record<string, unknown>>,
  ops: readonly JsonPatchOp[],
): Record<string, unknown> {
  let working = structuredClone(snapshot) as Record<string, unknown>
  for (const op of ops) {
    try {
      const tokens = parsePointer(op.path)
      if (op.op === 'add' || op.op === 'replace') {
        if (tokens.length === 0) {
          if (isObjectRecord(op.value)) {
            working = structuredClone(op.value)
          }
          continue
        }
        const resolved = resolveParent(working, tokens)
        if (!resolved) continue
        const val = structuredClone(op.value)
        if (Array.isArray(resolved.parent)) {
          if (op.op === 'add') {
            const idx = resolved.key === '-' ? resolved.parent.length : Number(resolved.key)
            if (Number.isInteger(idx) && idx >= 0 && idx <= resolved.parent.length) {
              resolved.parent.splice(idx, 0, val)
            }
          } else {
            const idx = Number(resolved.key)
            if (Number.isInteger(idx) && idx >= 0 && idx < resolved.parent.length) {
              resolved.parent[idx] = val
            }
          }
        } else {
          resolved.parent[resolved.key] = val
        }
      } else if (op.op === 'remove') {
        const resolved = resolveParent(working, tokens)
        if (!resolved) continue
        if (Array.isArray(resolved.parent)) {
          const idx = Number(resolved.key)
          if (Number.isInteger(idx) && idx >= 0 && idx < resolved.parent.length) {
            resolved.parent.splice(idx, 1)
          }
        } else {
          delete resolved.parent[resolved.key]
        }
      }
    } catch {
      // 单条补丁在本地快照无法应用时跳过，避免破坏缓存
    }
  }
  return working
}
