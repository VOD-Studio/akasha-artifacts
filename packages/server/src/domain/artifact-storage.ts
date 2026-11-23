/** 一个存储命名空间在某个修订号下的完整内容。 */
export interface ArtifactStorageSnapshot {
  /** 内容的修订号；首次写入后为 1，`0` 表示尚未创建。 */
  revision: number
  /** 键值对象序列化后的 JSON 文本。 */
  json: string
}

/**
 * 制品存储的键值仓储，以命名空间为隔离单位。
 *
 * @remarks 配额校验与写入必须基于同一修订号：`compareAndSet` 只在当前修订号等于入参时写入，
 * 因此调用方校验配额所读到的版本就是写入所依据的版本。
 */
export interface ArtifactStorageRepository {
  /** 命名空间不存在时返回 `null`。 */
  read(namespace: string): Promise<ArtifactStorageSnapshot | null>
  /** 乐观并发写：当前修订号等于 `revision` 才写入并返回 `true`，否则返回 `false`。 */
  compareAndSet(namespace: string, revision: number, json: string): Promise<boolean>
}
