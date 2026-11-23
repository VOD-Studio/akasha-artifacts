import type { JsonPatchOp } from '@akasha/protocol'
import { createContext, useContext, useSyncExternalStore } from 'react'
import { applyJsonPatch } from './json-patch'

/**
 * 沙盒内的实时状态流存储。
 *
 * @remarks 状态补丁只原子地更新快照并通知订阅的组件，不重新挂载根组件。
 */
export class ArtifactStateStore {
  private seq = 0
  private snapshot: Record<string, unknown> = {}
  private readonly listeners = new Set<() => void>()

  /** 用整份快照替换当前状态；`render` 时使用。 */
  replace(nextSnapshot: Record<string, unknown>, seq = 0): void {
    this.seq = seq
    this.snapshot = structuredClone(nextSnapshot)
    this.emit()
  }

  /** 应用一条补丁；`seq` 不大于当前序号时忽略，避免重连补发造成重复应用。 */
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

/** 供 Artifact 源码读取实时状态；组件保持挂载，只在快照变化时重渲染。 */
export function useArtifactState<T extends Record<string, unknown> = Record<string, unknown>>(): T {
  const store = useContext(ArtifactStateContext)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as T
}
