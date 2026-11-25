import type { PublicId, Slug } from '@akasha/protocol'
import { KeyedAsyncLock } from '../keyed-lock.js'

/** 发布与迁移均先锁目标项目的 slug，再锁已存在制品的 publicId。 */
export class ArtifactWriteLocks {
  private readonly locks = new KeyedAsyncLock()

  forSlug<T>(projectId: string, slug: Slug, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(`slug:${projectId}::${slug}`, fn)
  }

  forArtifact<T>(publicId: PublicId, fn: () => Promise<T>): Promise<T> {
    return this.locks.run(`artifact:${publicId}`, fn)
  }
}
