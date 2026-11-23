import type {
  ArtifactStorageRepository,
  ArtifactStorageSnapshot,
} from '../../../domain/artifact-storage.js'

/** 制品存储的内存实现；命名空间之间彼此隔离。 */
export class InMemoryArtifactStorage implements ArtifactStorageRepository {
  private readonly namespaces = new Map<string, ArtifactStorageSnapshot>()

  async read(namespace: string): Promise<ArtifactStorageSnapshot | null> {
    return this.namespaces.get(namespace) ?? null
  }

  async compareAndSet(namespace: string, revision: number, json: string): Promise<boolean> {
    if ((this.namespaces.get(namespace)?.revision ?? 0) !== revision) return false
    this.namespaces.set(namespace, { revision: revision + 1, json })
    return true
  }
}
