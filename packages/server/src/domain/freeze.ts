/** 递归冻结对象及其全部嵌套对象并原样返回，用于保证已发布版本与快照不被原地修改。 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== 'object') {
    return value
  }
  Object.freeze(value)
  for (const prop of Object.values(value as Record<string, unknown>)) {
    // 已冻结的节点不再进入，循环引用也由此终止
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop)
    }
  }
  return value
}
