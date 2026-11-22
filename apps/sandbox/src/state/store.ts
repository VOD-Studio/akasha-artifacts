import type { JsonPatchOp } from '@akasha/protocol'
import { createContext, useContext, useSyncExternalStore } from 'react'
import { applyJsonPatch } from './json-patch'

// 沙盒实时状态流存储：收到 state 补丁仅原子更新快照并通知订阅组件，绝不重新挂载根组件。
export class ArtifactStateStore {
  private seq = 0
  private snapshot: Record<string, unknown> = {}
  private readonly listeners = new Set<() => void>()

  replace(nextSnapshot: Record<string, unknown>, seq = 0): void {
    this.seq = seq
    this.snapshot = structuredClone(nextSnapshot)
    this.emit()
  }

  applyPatch(seq: number, ops: readonly JsonPatchOp[]): void {
    if (seq <= this.seq && this.seq > 0) return
    const next = applyJsonPatch(this.snapshot, ops)
    this.seq = seq
    this.snapshot = next
    this.emit()
  }

  getSeq(): number {
    return this.seq
  }

  getSnapshot = (): Record<string, unknown> => {
    return this.snapshot
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const defaultArtifactStateStore = new ArtifactStateStore()
export const ArtifactStateContext = createContext<ArtifactStateStore>(defaultArtifactStateStore)

// 暴露给 Artifact 源码的实时状态读取 Hook：组件保持挂载实例，仅按快照重渲染。
export function useArtifactState<T extends Record<string, unknown> = Record<string, unknown>>(): T {
  const store = useContext(ArtifactStateContext)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as T
}
