export interface ArtifactStorageSnapshot {
  revision: number
  json: string
}

// revision=0 表示尚未创建；修改必须核对配额所基于的同一版本。
export interface ArtifactStorageRepository {
  read(namespace: string): Promise<ArtifactStorageSnapshot | null>
  compareAndSet(namespace: string, revision: number, json: string): Promise<boolean>
}
