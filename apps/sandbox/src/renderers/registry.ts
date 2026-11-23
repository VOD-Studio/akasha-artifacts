import type { ArtifactType, ElementRef } from '@akasha/protocol'
import type { ReactNode } from 'react'
import type { PreservedStateManager } from '../state/preserve'
import type { ArtifactStateStore } from '../state/store'

export interface RendererProps {
  source: string
  version: number
  stateStore: ArtifactStateStore
  preserved: PreservedStateManager
  onError: (err: {
    phase: 'compile' | 'runtime'
    message: string
    stack?: string
    loc?: string
  }) => void
  onRendered: (version?: number) => void
  onRequestAnnotation?: (element: ElementRef) => void
}

export type ArtifactRenderer = (props: RendererProps) => ReactNode

const registry = new Map<ArtifactType, ArtifactRenderer>()

// 渲染器注册表：内置五类（html/markdown/mermaid/svg/react）及后续 M3 Kit 模板统一从此扩展。
export function registerRenderer(type: ArtifactType, renderer: ArtifactRenderer): void {
  registry.set(type, renderer)
}

export function getRenderer(type: ArtifactType): ArtifactRenderer | undefined {
  return registry.get(type)
}

export function listRegisteredRenderers(): readonly ArtifactType[] {
  return Array.from(registry.keys())
}
