import type { PublicId } from '@akasha/protocol'
import type { ArtifactStorageRepository } from '../domain/artifact-storage.js'
import { executeArtifactStorage } from './artifact-storage.js'

// 普通制品存储以 publicId 隔离；这个内部命名空间不能由沙盒或存储接口指定。
const favorites = '@akasha/favorites'

/** 读取调用方的收藏索引；可见性须在返回给调用方前按当前权限过滤。 */
export async function listArtifactFavorites(
  repository: ArtifactStorageRepository,
  principal: string,
): Promise<PublicId[]> {
  return (await executeArtifactStorage(repository, favorites, principal, {
    action: 'list',
    scope: 'private',
  })) as PublicId[]
}

/** 写入个人索引，不修改制品、项目可见性或更新时间。 */
export async function setArtifactFavorite(
  repository: ArtifactStorageRepository,
  principal: string,
  id: PublicId,
  favorite: boolean,
): Promise<void> {
  await executeArtifactStorage(
    repository,
    favorites,
    principal,
    favorite
      ? { action: 'set', scope: 'private', key: id, value: true }
      : { action: 'delete', scope: 'private', key: id },
  )
}
