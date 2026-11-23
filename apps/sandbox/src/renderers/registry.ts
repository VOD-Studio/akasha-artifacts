import type { ArtifactType, ElementRef } from '@akasha/protocol'
import type { ReactNode } from 'react'
import type { PreservedStateManager } from '../state/preserve'
import type { ArtifactStateStore } from '../state/store'

/** 传给每个渲染器的输入。 */
export interface RendererProps {
  /** 当前版本的完整源码。 */
  source: string
  /** HTML 画板的 id；给出时整段源码作为一个画板块渲染，不注入 `data-ak-loc`。 */
  boardId?: string
  version: number
  /** 实时状态流；状态更新只触发重渲染，不替换渲染器实例。 */
  stateStore: ArtifactStateStore
  /** 跨重绘保留的视图与控件值。 */
  preserved: PreservedStateManager
  /** 编译或运行出错时上报外壳；`phase` 区分编译期与运行时。 */
  onError: (err: {
    phase: 'compile' | 'runtime'
    message: string
    stack?: string
    loc?: string
  }) => void
  /** 内容渲染完成后调用；带版本号时表示该版本已呈现。 */
  onRendered: (version?: number) => void
  /** 模板内部发起批注时调用，例如框选数据点。 */
  onRequestAnnotation?: (element: ElementRef) => void
}

export type ArtifactRenderer = (props: RendererProps) => ReactNode

const registry = new Map<ArtifactType, ArtifactRenderer>()

/** 注册某类型的渲染器；同一类型后注册的覆盖先注册的。 */
export function registerRenderer(type: ArtifactType, renderer: ArtifactRenderer): void {
  registry.set(type, renderer)
}

export function getRenderer(type: ArtifactType): ArtifactRenderer | undefined {
  return registry.get(type)
}

export function listRegisteredRenderers(): readonly ArtifactType[] {
  return Array.from(registry.keys())
}
