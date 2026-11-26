import type { DesignSystemReference } from '@akasha/protocol'

/** 不随预览 JSON 返回；校验时必须由服务端用已授权的固定版本重新生成。 */
export const catalogRegions = Symbol('catalogRegions')

/** 生成器在写入时标记 UTF-16 区间，不从用户的源码推导边界或来源。 */
export type CatalogRegion = { start: number; end: number } & (
  | { kind: 'title' | 'reference' }
  | { kind: 'model'; reference: DesignSystemReference }
  | { kind: 'component'; reference: DesignSystemReference; index: number; close: string }
)

/** 公开预览只包含独立源码和固定引用；内部标记不会赋予候选稿修改任意源码的权限。 */
export interface CatalogBoardSource {
  source: string
  references: DesignSystemReference[]
  [catalogRegions]: CatalogRegion[]
}

/** 仅使用生成顺序作本稿内的唯一边界，不把用户路径或代码拼到注释中。 */
export function componentFence(system: number, index: number, side: 'begin' | 'end') {
  return `/* @akasha/catalog-slot ${system}.${index} ${side} */`
}
