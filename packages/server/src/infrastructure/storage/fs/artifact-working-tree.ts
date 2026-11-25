import fs from 'node:fs'
import path from 'node:path'
import { type Artifact, type PublicId, PublicIdSchema } from '@akasha/protocol'
import { DomainError } from '../../../domain/errors.js'
import type { SqliteArtifactRepository } from '../sqlite/index.js'
import {
  ARTIFACT_ID_FILENAME,
  type ArtifactFileLayout,
  assertRealPathInsideRoot,
  CANONICAL_ENTRY_FILENAMES,
  parseArtifactPathFromFs,
  resolveArtifactFileLayout,
  resolveRealPathAllowMissing,
  STATE_DIR_NAME,
} from './file-layout.js'

// 先写同目录临时文件再 rename，监听器不会读到写了一半的内容
function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

/** 单个文件仓库的目录占用与自写缓存；仅在同一项目根目录内读写原生文件。 */
export class ArtifactWorkingTree {
  // 记录服务端最近一次落盘的源码内容，供文件监听器识别并跳过自写回环
  private readonly lastWrittenContent = new Map<string, string>()
  // 同步记录已被占用的规范物理目录（防止并发首次发布 card 与 html/card 同时通过校验并互相覆写）
  private readonly reservedDirs = new Map<string, PublicId>()

  constructor(
    readonly artifactsRoot: string,
    private readonly projectId: string,
    private readonly inner: SqliteArtifactRepository,
  ) {}

  findExistingDiskEntries(artifact: Artifact): string[] {
    const layout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    const found: string[] = []
    for (const filename of CANONICAL_ENTRY_FILENAMES[artifact.type]) {
      const candidate = path.join(layout.artifactDir, filename)
      if (!fs.existsSync(candidate)) continue
      try {
        assertRealPathInsideRoot(this.artifactsRoot, candidate)
        if (fs.statSync(candidate).isFile()) found.push(candidate)
      } catch {
        // 忽略非法或非普通文件
      }
    }
    return found
  }

  /**
   * 检查索引记录指向的原物理目录是否仍存在有效的规范源文件，且未被其他 `publicId` 接管。
   *
   * @remarks 用于区分「目录真的移动了」与「带着 `.artifact-id` 复制了目录」，
   * 防止复制的目录劫持原制品的身份。
   */
  hasLiveIndexedLayout(artifact: Artifact): boolean {
    const entries = this.findExistingDiskEntries(artifact)
    if (entries.length === 0) return false
    const layout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    if (fs.existsSync(layout.idFile)) {
      try {
        const rawId = fs.readFileSync(layout.idFile, 'utf8').trim()
        if (rawId && rawId !== artifact.publicId) {
          return false
        }
      } catch {
        // 忽略瞬时读取异常
      }
    }
    return true
  }

  // 在 .artifacts/ 根目录内查找持有指定 publicId 的其它 .artifact-id 所在目录（跳过 .state 与符号链接），
  // 用于在旧目录已缺失时识别防抖窗口内尚未同步的目录移动，防止服务端在旧路径重建第二份同 ID 目录。
  findRelocatedDirByPublicId(publicId: PublicId, excludeDir: string): string | null {
    const root = path.resolve(this.artifactsRoot)
    if (!fs.existsSync(root)) return null
    const excludedReal = resolveRealPathAllowMissing(excludeDir)
    const queue: string[] = [root]
    while (queue.length > 0) {
      const dir = queue.shift()
      if (!dir) continue
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === STATE_DIR_NAME || entry.name.startsWith('.')) continue
          queue.push(full)
        } else if (entry.isFile() && entry.name === ARTIFACT_ID_FILENAME) {
          if (resolveRealPathAllowMissing(dir) === excludedReal) continue
          try {
            if (fs.readFileSync(full, 'utf8').trim() === publicId) {
              return dir
            }
          } catch {
            // 忽略读取异常
          }
        }
      }
    }
    return null
  }

  assertOwnedProject(projectId: string): void {
    if (projectId !== this.projectId) {
      throw new DomainError(
        'BAD_REQUEST',
        `当前 .artifacts/ 文件存储仅绑定项目 "${this.projectId}"，拒绝写入其它项目 "${projectId}"，以避免跨项目覆写原生文件`,
        { expectedProjectId: this.projectId, actualProjectId: projectId },
      )
    }
  }

  // 全同步完成物理目录占用与并发占位校验（中间无 await 间隙），并统一按真实规范路径比对，彻底消除别名 slug 并发或符号链接覆写。
  assertNoPhysicalDirCollisionSync(artifact: Artifact, layout: ArtifactFileLayout): void {
    const targetDir = resolveRealPathAllowMissing(layout.artifactDir)
    const reservedOwner = this.reservedDirs.get(targetDir)
    if (reservedOwner && reservedOwner !== artifact.publicId) {
      const existingReserved = this.inner.findByPublicIdSync(reservedOwner)
      if (
        !existingReserved ||
        resolveRealPathAllowMissing(
          resolveArtifactFileLayout(
            this.artifactsRoot,
            existingReserved.type,
            existingReserved.slug,
          ).artifactDir,
        ) === targetDir
      ) {
        throw new DomainError(
          'BAD_REQUEST',
          `物理目录 "${layout.normalizedRelativeDir}" 已被 Artifact "${reservedOwner}" 占用，请使用不同的 slug`,
          { conflictingPublicId: reservedOwner },
        )
      }
      this.reservedDirs.delete(targetDir)
    }

    for (const existing of this.inner.listByProjectSync(this.projectId)) {
      if (existing.publicId === artifact.publicId) continue
      const existingLayout = resolveArtifactFileLayout(
        this.artifactsRoot,
        existing.type,
        existing.slug,
      )
      if (resolveRealPathAllowMissing(existingLayout.artifactDir) === targetDir) {
        throw new DomainError(
          'BAD_REQUEST',
          `物理目录 "${layout.normalizedRelativeDir}" 已被 Artifact "${existing.publicId}"（slug: "${existing.slug}"）占用，请使用不同的 slug`,
          { conflictingPublicId: existing.publicId, conflictingSlug: existing.slug },
        )
      }
    }

    if (!fs.existsSync(layout.idFile)) return
    let rawId: string
    try {
      rawId = fs.readFileSync(layout.idFile, 'utf8').trim()
    } catch {
      return
    }
    const parsedId = PublicIdSchema.safeParse(rawId)
    if (!parsedId.success || parsedId.data === artifact.publicId) return

    const owner = this.inner.findByPublicIdSync(parsedId.data)
    if (!owner) return
    const ownerLayout = resolveArtifactFileLayout(this.artifactsRoot, owner.type, owner.slug)
    if (resolveRealPathAllowMissing(ownerLayout.artifactDir) === targetDir) {
      throw new DomainError(
        'BAD_REQUEST',
        `物理目录 "${layout.normalizedRelativeDir}" 已被 Artifact "${owner.publicId}"（slug: "${owner.slug}"）占用，请使用不同的 slug`,
        { conflictingPublicId: owner.publicId, conflictingSlug: owner.slug },
      )
    }
  }

  reserve(targetDir: string, publicId: PublicId): void {
    this.reservedDirs.set(targetDir, publicId)
  }

  release(targetDir: string): void {
    this.reservedDirs.delete(targetDir)
  }

  forgetSyncedContent(filePath: string): void {
    this.lastWrittenContent.delete(path.resolve(filePath))
  }

  updateIndexedDirectory(
    previous: Artifact | undefined,
    layout: ArtifactFileLayout,
    publicId: PublicId,
  ): void {
    if (previous) {
      const prevLayout = resolveArtifactFileLayout(this.artifactsRoot, previous.type, previous.slug)
      for (const filename of CANONICAL_ENTRY_FILENAMES[previous.type]) {
        this.lastWrittenContent.delete(path.resolve(path.join(prevLayout.artifactDir, filename)))
      }
      const prevDir = resolveRealPathAllowMissing(prevLayout.artifactDir)
      if (this.reservedDirs.get(prevDir) === previous.publicId) {
        this.reservedDirs.delete(prevDir)
      }
    }
    this.reservedDirs.set(resolveRealPathAllowMissing(layout.artifactDir), publicId)
  }

  /** 判定磁盘上的内容是否服务端自己刚写入的；是则监听器跳过，避免自触发。 */
  isOwnWrite(filePath: string, content: string): boolean {
    const resolved = path.resolve(filePath)
    if (this.lastWrittenContent.get(resolved) !== content) {
      return false
    }
    // 仅当磁盘文件的 .artifact-id 与索引中记录的当前物理目录及类型完全一致时，才判定为自写回环；
    // 若目录先改名后又移回原路径（内容未变），必须放行给监听器重新对账索引与 slug。
    const parsed = parseArtifactPathFromFs(this.artifactsRoot, resolved)
    if (!parsed) return false
    const indexed = parsed.existingPublicId
      ? this.inner.findByPublicIdSync(parsed.existingPublicId)
      : undefined
    if (!indexed) {
      this.lastWrittenContent.delete(resolved)
      return false
    }
    const indexedDir = resolveRealPathAllowMissing(
      resolveArtifactFileLayout(this.artifactsRoot, indexed.type, indexed.slug).artifactDir,
    )
    const actualDir = resolveRealPathAllowMissing(parsed.artifactDir)
    if (indexed.type !== parsed.type || indexedDir !== actualDir) {
      this.lastWrittenContent.delete(resolved)
      return false
    }
    return true
  }

  /** 记录服务端最近一次落盘的内容，供 `isOwnWrite` 比对。 */
  recordSyncedContent(filePath: string, content: string): void {
    this.lastWrittenContent.set(path.resolve(filePath), content)
  }

  retireObsoleteLayout(previous: Artifact, nextArtifactDir: string): void {
    const prevLayout = resolveArtifactFileLayout(this.artifactsRoot, previous.type, previous.slug)
    const prevDir = resolveRealPathAllowMissing(prevLayout.artifactDir)
    if (prevDir === resolveRealPathAllowMissing(nextArtifactDir)) return
    if (this.reservedDirs.get(prevDir) === previous.publicId) {
      this.reservedDirs.delete(prevDir)
    }
    if (!fs.existsSync(prevDir)) return
    assertRealPathInsideRoot(this.artifactsRoot, prevLayout.artifactDir)

    // 仅清理属于当前 Artifact 的 .artifact-id 与对应类型的规范入口文件，不误删无关用户文件
    if (fs.existsSync(prevLayout.idFile)) {
      try {
        const idOnDisk = fs.readFileSync(prevLayout.idFile, 'utf8').trim()
        if (idOnDisk && idOnDisk !== previous.publicId) {
          return
        }
        fs.rmSync(prevLayout.idFile, { force: true })
      } catch {
        // 忽略清理异常
      }
    }

    for (const filename of CANONICAL_ENTRY_FILENAMES[previous.type]) {
      const candidate = path.join(prevDir, filename)
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { force: true })
        this.lastWrittenContent.delete(path.resolve(candidate))
      }
    }

    // 自底向上回收空目录（绝不删除 artifactsRoot 本身；统一按真实规范路径比对以兼容 macOS /var -> /private/var）
    const root = resolveRealPathAllowMissing(this.artifactsRoot)
    let cur = prevDir
    while (cur !== root && cur.startsWith(`${root}${path.sep}`)) {
      try {
        if (fs.readdirSync(cur).length === 0) {
          fs.rmdirSync(cur)
          cur = path.dirname(cur)
        } else {
          break
        }
      } catch {
        break
      }
    }
  }

  syncToDisk(artifact: Artifact, source: string): ArtifactFileLayout {
    this.assertOwnedProject(artifact.projectId)
    const layout = resolveArtifactFileLayout(
      this.artifactsRoot,
      artifact.type,
      artifact.slug,
      source,
    )
    fs.mkdirSync(layout.artifactDir, { recursive: true })

    let entryFile = layout.entryFile

    // document 类型在 HTML 与 JSON 格式间切换时清理另一份过期入口文件，防止监听器误读旧文件
    if (artifact.type === 'document') {
      const sibling =
        path.basename(entryFile) === 'index.json'
          ? path.join(layout.artifactDir, 'index.html')
          : path.join(layout.artifactDir, 'index.json')
      if (fs.existsSync(sibling)) {
        fs.rmSync(sibling, { force: true })
        this.lastWrittenContent.delete(path.resolve(sibling))
      }
    } else if (artifact.type === 'react') {
      // react 支持 index.tsx 与 index.jsx：若已有独立 index.jsx 则沿用该入口写回；否则统一写 index.tsx 并清理过期 index.jsx，避免重启时旧 jsx 覆盖新版本
      const tsxFile = path.join(layout.artifactDir, 'index.tsx')
      const jsxFile = path.join(layout.artifactDir, 'index.jsx')
      if (fs.existsSync(jsxFile) && !fs.existsSync(tsxFile)) {
        entryFile = jsxFile
      } else {
        entryFile = tsxFile
        if (fs.existsSync(jsxFile)) {
          fs.rmSync(jsxFile, { force: true })
          this.lastWrittenContent.delete(path.resolve(jsxFile))
        }
      }
    }

    assertRealPathInsideRoot(this.artifactsRoot, layout.artifactDir)
    assertRealPathInsideRoot(this.artifactsRoot, entryFile)
    assertRealPathInsideRoot(this.artifactsRoot, layout.idFile)

    this.lastWrittenContent.set(path.resolve(entryFile), source)
    writeFileAtomic(entryFile, source)

    this.writeIdentity(layout, artifact.publicId)

    return { ...layout, entryFile }
  }

  writeIdentity(layout: ArtifactFileLayout, publicId: PublicId): void {
    const idBody = `${publicId}\n`
    if (!fs.existsSync(layout.idFile) || fs.readFileSync(layout.idFile, 'utf8') !== idBody) {
      writeFileAtomic(layout.idFile, idBody)
    }
  }
}
