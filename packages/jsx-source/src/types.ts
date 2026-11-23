/** 源码里带稳定块标识的元素。 */
export interface BlockEntry {
  /** 块标识，取自 `sourceAttr` 指向的属性。 */
  blockId: string
  loc: string
  /** 标签的起始位置，行列均从 1 起。 */
  line: number
  column: number
  sourceAttr: 'data-ak-block' | 'id'
}

/** 被注入 `data-ak-loc` 的元素。 */
export interface InjectedLocationEntry {
  tagName: string
  loc: string
  line: number
  column: number
  /** 位于 `.map` 等循环生成的节点内；这类元素同时被标上 `data-ak-dynamic`。 */
  dynamic: boolean
  /** 元素自身声明的块标识；没有则省略。 */
  blockId?: string
}

/** 位置注入的结果：改写后的源码，以及供校验与运行时使用的索引。 */
export interface InjectLocationsResult {
  /** 注入后的源码；未改动位置的行列号与原稿一致。 */
  code: string
  /** 全部被注入的元素，按 `loc` 可反查。 */
  locations: InjectedLocationEntry[]
  /** 带块标识的元素。 */
  blocks: BlockEntry[]
}

/** 在 `offset` 处插入 `text`。 */
export interface StringInsertion {
  offset: number
  text: string
}

/**
 * 按偏移量降序逐个插入，前面的插入因此不会改变后面插入点的位置。
 *
 * @remarks 未改动部分的行列号与原稿保持一致。
 */
export function applyInsertions(source: string, insertions: readonly StringInsertion[]): string {
  if (insertions.length === 0) return source
  const sorted = [...insertions].sort((a, b) => b.offset - a.offset)
  let out = source
  for (const ins of sorted) {
    out = `${out.slice(0, ins.offset)}${ins.text}${out.slice(ins.offset)}`
  }
  return out
}
