// 纯 TS 递归冻结：保证已发布 Version 与快照在运行期不可被任何调用方原地修改。
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object') {
    return value
  }
  Object.freeze(value)
  for (const prop of Object.values(value as Record<string, unknown>)) {
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop)
    }
  }
  return value
}
