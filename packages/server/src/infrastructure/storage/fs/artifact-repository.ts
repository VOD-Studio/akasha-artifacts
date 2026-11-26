import type { Artifact, ArtifactType, PublicId, Slug, Version } from '@akasha/protocol'
import { DomainError } from '../../../domain/errors.js'
import type { ArtifactRepository } from '../../../domain/ports.js'
import type { SqliteArtifactRepository } from '../sqlite/index.js'
import { ArtifactWorkingTree } from './artifact-working-tree.js'
import { ExternalEditReconciler } from './external-edit-reconciler.js'
import { resolveArtifactFileLayout, resolveRealPathAllowMissing } from './file-layout.js'

/**
 * `ArtifactRepository` 的文件存储实现：源码落盘为原生文件，元数据与版本历史仍存 SQLite。
 *
 * @remarks 每次写入都先做物理目录碰撞校验与外部改动对账，再与 SQLite 在单个同步事务内提交；
 * 校验失败时不落盘、不残留版本行。目录布局与 `.artifact-id` 见 `FsArtifactsStorage`。
 */
export class FsArtifactRepository implements ArtifactRepository {
  // 暂存 v2+ 待提交版本：先经 saveArtifact 完成项目归属与物理目录碰撞校验，再与元数据在单事务内原子提交，防止校验拒绝后遗留孤儿版本
  private readonly pendingVersions = new Map<PublicId, Readonly<Version>>()
  private readonly files: ArtifactWorkingTree
  private readonly edits: ExternalEditReconciler

  constructor(
    private readonly artifactsRoot: string,
    projectId: string,
    private readonly inner: SqliteArtifactRepository,
  ) {
    this.files = new ArtifactWorkingTree(artifactsRoot, projectId, inner)
    this.edits = new ExternalEditReconciler(this.files, inner)
  }

  get lifecycle() {
    return this.inner.lifecycle
  }

  get boardProjections() {
    return this.inner.boardProjections
  }

  /** 注册回调：服务端写入前补录了未入库的外部改动时触发，用于把补录的版本广播出去。 */
  setOnDiskReconciled(cb: (artifact: Artifact, version: Readonly<Version>) => void): void {
    this.edits.setOnDiskReconciled(cb)
  }

  /** 标记某文件正由监听器或全量扫描导入，使随后的首次发布不被当作覆写未入库的文件。 */
  markImportingExternalFile(filePath: string, slug: Slug, source: string): void {
    this.edits.markImportingExternalFile(filePath, slug, source)
  }

  /** 清除导入标记。 */
  clearImportingExternalFile(filePath: string): void {
    this.edits.clearImportingExternalFile(filePath)
  }

  /**
   * 检查索引记录指向的原物理目录是否仍存在有效的规范源文件，且未被其他 `publicId` 接管。
   *
   * @remarks 用于区分「目录真的移动了」与「带着 `.artifact-id` 复制了目录」，
   * 防止复制的目录劫持原制品的身份。
   */
  hasLiveIndexedLayout(artifact: Artifact): boolean {
    return this.files.hasLiveIndexedLayout(artifact)
  }

  /** 判定磁盘上的内容是否服务端自己刚写入的；是则监听器跳过，避免自触发。 */
  isOwnWrite(filePath: string, content: string): boolean {
    return this.files.isOwnWrite(filePath, content)
  }

  /** 记录服务端最近一次落盘的内容，供 `isOwnWrite` 比对。 */
  recordSyncedContent(filePath: string, content: string): void {
    this.files.recordSyncedContent(filePath, content)
  }

  /**
   * 只更新索引里的目录元数据（slug、type、updatedAt），不改写磁盘上的源文件。
   *
   * @remarks 内部重读最新记录并保留既有 `headVersion`，防止与并发的发布或更新交错时回退版本号。
   */
  async updateIndexOnly(artifact: Artifact): Promise<Artifact> {
    this.files.assertOwnedProject(artifact.projectId)
    const nextLayout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    const previous = this.inner.findByPublicIdSync(artifact.publicId)
    if (previous?.type === 'design-system' || artifact.type === 'design-system') {
      throw new DomainError('FORBIDDEN', '目录监听不能重建或转换设计系统')
    }
    const merged: Artifact = previous
      ? {
          ...previous,
          slug: artifact.slug,
          type: artifact.type,
          updatedAt: artifact.updatedAt,
        }
      : artifact
    // 变更目录索引前同样执行物理目录占用校验，防止移入已被短 slug（如 card）占用的同一物理目录
    this.files.assertNoPhysicalDirCollisionSync(merged, nextLayout)
    this.files.updateIndexedDirectory(previous, nextLayout, merged.publicId)
    await this.inner.saveArtifact(merged)
    return merged
  }

  /**
   * 保存制品元数据；该制品有待提交的新版本时，与它一起原子提交并把源码落盘。
   *
   * @remarks `appendVersion` 对 v2 及之后的版本只暂存，真正的落盘发生在这里。
   */
  async saveArtifact(artifact: Artifact): Promise<void> {
    const staged = this.pendingVersions.get(artifact.publicId)
    this.pendingVersions.delete(artifact.publicId)
    const stagedForHead = staged && staged.version === artifact.headVersion ? staged : undefined

    this.files.assertOwnedProject(artifact.projectId)
    const layout = resolveArtifactFileLayout(
      this.artifactsRoot,
      artifact.type,
      artifact.slug,
      stagedForHead?.source,
    )
    // 以下校验、外部未同步改动对账、占位与 SQLite 原子提交全同步执行，避免并发别名碰撞或静默覆写外部编辑
    this.files.assertNoPhysicalDirCollisionSync(artifact, layout)
    const previous = this.inner.findByPublicIdSync(artifact.publicId)
    const targetDir = resolveRealPathAllowMissing(layout.artifactDir)
    this.edits.reconcileBeforeWrite(artifact, layout, targetDir, previous, stagedForHead)
    this.files.reserve(targetDir, artifact.publicId)

    try {
      this.inner.saveArtifactWithVersionSync(artifact, stagedForHead)
    } catch (err) {
      if (!previous) {
        this.files.release(targetDir)
      }
      throw err
    }

    const headVer =
      stagedForHead ?? (await this.inner.getVersion(artifact.publicId, artifact.headVersion))
    if (!headVer) return
    const written = this.files.syncToDisk(artifact, headVer.source)
    if (previous) {
      this.files.retireObsoleteLayout(previous, written.artifactDir)
    }
  }

  renameTitle(id: PublicId, title: string, updatedAt: string): Promise<Artifact | undefined> {
    return this.inner.renameTitle(id, title, updatedAt)
  }

  async relocate(): Promise<never> {
    // .artifacts 根目录与仓储绑定一个项目，不能把原生文件迁到未受这套存储管理的位置。
    throw new DomainError(
      'BAD_REQUEST',
      '原生文件模式只绑定一个项目；跨项目移动须使用 SQLite Daemon 或同一自托管 Hub',
    )
  }

  findByPublicId(publicId: PublicId): Promise<Artifact | undefined> {
    return this.inner.findByPublicId(publicId)
  }

  findBySlug(projectId: string, slug: Slug): Promise<Artifact | undefined> {
    return this.inner.findBySlug(projectId, slug)
  }

  listByProject(projectId?: string): Promise<readonly Artifact[]> {
    return this.inner.listByProject(projectId)
  }

  /**
   * 追加版本；v2 及之后的版本先暂存，等随后的 `saveArtifact` 校验通过后一起提交。
   */
  async appendVersion(version: Readonly<Version>, type?: ArtifactType): Promise<void> {
    const artifact = await this.inner.findByPublicId(version.artifactId)
    if (artifact) {
      this.files.assertOwnedProject(artifact.projectId)
      // v2+ 更新：先暂存版本，等待随后的 saveArtifact 使用更新后的 type/slug 校验并原子提交；
      // 若目录碰撞或校验失败，versions 表不会残留孤儿行阻塞后续写入。
      if (version.version > artifact.headVersion) {
        this.pendingVersions.set(artifact.publicId, version)
        return
      }
      resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug, version.source)
    }
    await this.inner.appendVersion(version, type ?? artifact?.type)
    // 新建 v1（saveArtifact 先于 appendVersion，此时 version === headVersion）立即落盘原生文件
    if (artifact && version.version === artifact.headVersion) {
      this.files.syncToDisk(artifact, version.source)
    }
  }

  getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]> {
    return this.inner.getVersions(artifactId)
  }

  getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined> {
    return this.inner.getVersion(artifactId, version)
  }

  getVersionSummaries(artifactId: PublicId, version?: number) {
    return this.inner.getVersionSummaries(artifactId, version)
  }
}
