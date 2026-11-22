export interface BlockEntry {
  blockId: string
  loc: string
  line: number
  column: number
  sourceAttr: 'data-ak-block' | 'id'
}

export interface InjectedLocationEntry {
  tagName: string
  loc: string
  line: number
  column: number
  dynamic: boolean
  blockId?: string
}

export interface InjectLocationsResult {
  code: string
  locations: InjectedLocationEntry[]
  blocks: BlockEntry[]
}

export interface StringInsertion {
  offset: number
  text: string
}

// 按偏移量降序原地拼接插入文本，保持未改动位置的原始行列号完全不变。
export function applyInsertions(source: string, insertions: readonly StringInsertion[]): string {
  if (insertions.length === 0) return source
  const sorted = [...insertions].sort((a, b) => b.offset - a.offset)
  let out = source
  for (const ins of sorted) {
    out = `${out.slice(0, ins.offset)}${ins.text}${out.slice(ins.offset)}`
  }
  return out
}
