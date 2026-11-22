import fs from 'node:fs'
import path from 'node:path'
import {
  type Artifact,
  type ArtifactType,
  ArtifactTypeSchema,
  type PublicId,
  PublicIdSchema,
  type Slug,
  type Version,
} from '@akasha/protocol'
import { createImmutableVersion } from '../../../domain/artifact/index.js'
import { computeUnifiedDiff } from '../../../domain/diff.js'
import { DomainError, VersionConflictError } from '../../../domain/errors.js'
import type {
  ArtifactRepository,
  FeedbackRepository,
  ProjectRepository,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'
import { type SqliteArtifactRepository, SqliteStorage } from '../sqlite/index.js'

export const STATE_DIR_NAME = '.state'
export const ARTIFACT_ID_FILENAME = '.artifact-id'

const CANONICAL_ENTRY_FILENAMES: Record<ArtifactType, readonly string[]> = {
  react: ['index.tsx', 'index.jsx'],
  html: ['index.html'],
  markdown: ['index.md'],
  mermaid: ['diagram.mmd'],
  svg: ['graphic.svg'],
  document: ['index.html', 'index.json'],
  artboard: ['index.json'],
  verify: ['index.json'],
  'pr-walkthrough': ['index.json'],
  'live-timeline': ['index.json'],
  'option-compare': ['index.json'],
  'data-story': ['index.json'],
}

export function entryFilenameForType(type: ArtifactType, source?: string): string {
  switch (type) {
    case 'react':
      return 'index.tsx'
    case 'html':
      return 'index.html'
    case 'markdown':
      return 'index.md'
    case 'mermaid':
      return 'diagram.mmd'
    case 'svg':
      return 'graphic.svg'
    case 'document':
      return source?.trim().startsWith('{') ? 'index.json' : 'index.html'
    default:
      return 'index.json'
  }
}

export interface ArtifactFileLayout {
  artifactDir: string
  entryFile: string
  idFile: string
  normalizedRelativeDir: string
}

function resolveRealPathAllowMissing(targetPath: string): string {
  const abs = path.resolve(targetPath)
  const tail: string[] = []
  let cur = abs
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur)
    if (parent === cur) break
    tail.unshift(path.basename(cur))
    cur = parent
  }
  const realBase = fs.existsSync(cur) ? fs.realpathSync(cur) : cur
  return tail.length > 0 ? path.join(realBase, ...tail) : realBase
}

// 校验目标路径及其每一级已存在祖先（含符号链接与悬空链接）均严格落在 artifactsRoot 真实路径内部，防止通过 symlink 越界读写。
export function assertRealPathInsideRoot(artifactsRoot: string, targetPath: string): void {
  const lexicalRoot = path.resolve(artifactsRoot)
  const lexicalTarget = path.resolve(targetPath)
  if (lexicalTarget !== lexicalRoot && !lexicalTarget.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new DomainError('BAD_REQUEST', `Artifact 路径越界 "${targetPath}"`)
  }

  const realRoot = resolveRealPathAllowMissing(lexicalRoot)
  const rel = path.relative(lexicalRoot, lexicalTarget)
  if (!rel) return

  let cur = lexicalRoot
  for (const seg of rel.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg)
    let lstat: fs.Stats | undefined
    try {
      lstat = fs.lstatSync(cur)
    } catch {
      // 该层及更深目录尚未创建，已到达最深已存在祖先
      break
    }
    if (lstat.isSymbolicLink()) {
      throw new DomainError(
        'BAD_REQUEST',
        `符号链接路径 "${rel}" 不受支持，.artifacts 目录内禁止符号链接以防越界或别名覆写`,
      )
    }
  }

  const realTarget = resolveRealPathAllowMissing(lexicalTarget)
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new DomainError('BAD_REQUEST', `Artifact 真实路径越界 "${rel}"`)
  }
}

// 解析 Artifact 在 .artifacts/<type>/<slug>/ 下的安全物理路径，严防路径穿越与符号链接越界。
export function resolveArtifactFileLayout(
  artifactsRoot: string,
  type: ArtifactType,
  slug: Slug,
  source?: string,
): ArtifactFileLayout {
  const root = path.resolve(artifactsRoot)
  const cleanSlug = slug.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')

  if (
    !cleanSlug ||
    cleanSlug
      .split('/')
      .some((seg) => seg === '' || seg === '.' || seg === '..' || seg === STATE_DIR_NAME)
  ) {
    throw new DomainError('BAD_REQUEST', `非法的 Artifact slug 路径 "${slug}"`)
  }

  // 若 slug 已带 "<type>/" 前缀，则不再重复嵌套一层 type 目录
  const relDir = cleanSlug.startsWith(`${type}/`) ? cleanSlug : `${type}/${cleanSlug}`
  const artifactDir = path.resolve(root, relDir)
  if (artifactDir !== root && !artifactDir.startsWith(`${root}${path.sep}`)) {
    throw new DomainError('BAD_REQUEST', `Artifact 路径越界 "${slug}"`)
  }

  const entryName = entryFilenameForType(type, source)
  const entryFile = path.join(artifactDir, entryName)
  const idFile = path.join(artifactDir, ARTIFACT_ID_FILENAME)
  assertRealPathInsideRoot(root, artifactDir)
  assertRealPathInsideRoot(root, entryFile)
  assertRealPathInsideRoot(root, idFile)

  return {
    artifactDir,
    entryFile,
    idFile,
    normalizedRelativeDir: relDir,
  }
}

export interface ParsedFsArtifactPath {
  type: ArtifactType
  slug: Slug
  artifactDir: string
  entryFile: string
  idFile: string
  existingPublicId?: PublicId
}

// 从 .artifacts/ 内的物理文件路径反推出 (type, slug, publicId)，忽略 .state/、.artifact-id 与临时文件。
export function parseArtifactPathFromFs(
  artifactsRoot: string,
  absoluteFilePath: string,
): ParsedFsArtifactPath | null {
  const root = path.resolve(artifactsRoot)
  const target = path.resolve(absoluteFilePath)
  if (!target.startsWith(`${root}${path.sep}`)) return null
  try {
    assertRealPathInsideRoot(root, target)
  } catch {
    return null
  }

  const rel = path.relative(root, target)
  const segments = rel.split(path.sep).filter(Boolean)
  // 至少需要 <type>/<slug>/<file> 三级结构，且禁止命中 .state 或隐藏临时文件
  if (segments.length < 3) return null
  if (segments[0] === STATE_DIR_NAME) return null
  const filename = segments[segments.length - 1]
  if (
    !filename ||
    filename.startsWith('.') ||
    filename.endsWith('.tmp') ||
    filename.endsWith('~')
  ) {
    return null
  }

  const typeParsed = ArtifactTypeSchema.safeParse(segments[0])
  if (!typeParsed.success) return null

  const type = typeParsed.data
  // 仅严格匹配对应 Artifact 类型的规范小写入口文件名，避免辅助文件或大小写变体（如 INDEX.HTML）造成双入口并存
  if (!CANONICAL_ENTRY_FILENAMES[type].includes(filename)) {
    return null
  }
  const dirSegments = segments.slice(0, -1)
  const slug = dirSegments.join('/')
  const artifactDir = path.join(root, ...dirSegments)
  const idFile = path.join(artifactDir, ARTIFACT_ID_FILENAME)

  let existingPublicId: PublicId | undefined
  if (fs.existsSync(idFile)) {
    try {
      const rawId = fs.readFileSync(idFile, 'utf8').trim()
      const parsedId = PublicIdSchema.safeParse(rawId)
      if (parsedId.success) {
        existingPublicId = parsedId.data
      }
    } catch {
      // 忽略瞬时读取异常
    }
  }

  return {
    type,
    slug,
    artifactDir,
    entryFile: target,
    idFile,
    existingPublicId,
  }
}

function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

export class FsArtifactRepository implements ArtifactRepository {
  // 记录服务端最近一次落盘的源码内容，供文件监听器识别并跳过自写回环
  private readonly lastWrittenContent = new Map<string, string>()
  // 暂存 v2+ 待提交版本：先经 saveArtifact 完成项目归属与物理目录碰撞校验，再与元数据在单事务内原子提交，防止校验拒绝后遗留孤儿版本
  private readonly pendingVersions = new Map<PublicId, Readonly<Version>>()
  // 同步记录已被占用的规范物理目录（防止并发首次发布 card 与 html/card 同时通过校验并互相覆写）
  private readonly reservedDirs = new Map<string, PublicId>()
  private onDiskReconciled?: (artifact: Artifact, version: Readonly<Version>) => void

  constructor(
    private readonly artifactsRoot: string,
    private readonly projectId: string,
    private readonly inner: SqliteArtifactRepository,
  ) {}

  setOnDiskReconciled(cb: (artifact: Artifact, version: Readonly<Version>) => void): void {
    this.onDiskReconciled = cb
  }

  private findExistingDiskEntry(artifact: Artifact): string | null {
    const layout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    for (const filename of CANONICAL_ENTRY_FILENAMES[artifact.type]) {
      const candidate = path.join(layout.artifactDir, filename)
      if (!fs.existsSync(candidate)) continue
      try {
        assertRealPathInsideRoot(this.artifactsRoot, candidate)
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        // 忽略非法或非普通文件
      }
    }
    return null
  }

  // 在服务端写入覆写磁盘前检查是否存在尚未被防抖监听器捕获的外部磁盘改动：
  // 若磁盘内容已领先于数据库 headVersion，则先把外部修改入库为新版本并抛出 409 VERSION_CONFLICT，绝不静默覆盖外部改动。
  private reconcilePendingDiskEditBeforeWrite(
    previous: Artifact,
    stagedForHead: Readonly<Version>,
  ): void {
    const prevHeadVer = this.inner.getVersionSync(previous.publicId, previous.headVersion)
    if (!prevHeadVer) return
    const diskFile = this.findExistingDiskEntry(previous)
    if (!diskFile) return

    let diskSource: string
    try {
      diskSource = fs.readFileSync(diskFile, 'utf8')
    } catch {
      return
    }

    if (diskSource === prevHeadVer.source) return
    // 若本次写入正是监听器针对该磁盘快照的同步请求，直接放行
    if (stagedForHead.author === 'agent:fs' && diskSource === stagedForHead.source) return

    const nextExternalVersion = previous.headVersion + 1
    const now = new Date().toISOString()
    const externalVersion = createImmutableVersion({
      artifactId: previous.publicId,
      version: nextExternalVersion,
      parentVersion: previous.headVersion,
      author: 'agent:fs',
      title: previous.title,
      source: diskSource,
      createdAt: now,
    })
    const reconciledArtifact: Artifact = {
      ...previous,
      headVersion: nextExternalVersion,
      updatedAt: now,
    }
    this.inner.saveArtifactWithVersionSync(reconciledArtifact, externalVersion)
    this.recordSyncedContent(diskFile, diskSource)
    this.onDiskReconciled?.(reconciledArtifact, externalVersion)

    throw new VersionConflictError({
      artifactId: previous.publicId,
      baseVersion: previous.headVersion,
      headVersion: nextExternalVersion,
      diff: computeUnifiedDiff(
        prevHeadVer.source,
        diskSource,
        `v${previous.headVersion}`,
        `v${nextExternalVersion}`,
      ),
      authors: ['agent:fs'],
    })
  }

  private assertOwnedProject(projectId: string): void {
    if (projectId !== this.projectId) {
      throw new DomainError(
        'BAD_REQUEST',
        `当前 .artifacts/ 文件存储仅绑定项目 "${this.projectId}"，拒绝写入其它项目 "${projectId}"，以避免跨项目覆写原生文件`,
        { expectedProjectId: this.projectId, actualProjectId: projectId },
      )
    }
  }

  // 全同步完成物理目录占用与并发占位校验（中间无 await 间隙），并统一按真实规范路径比对，彻底消除别名 slug 并发或符号链接覆写。
  private assertNoPhysicalDirCollisionSync(artifact: Artifact, layout: ArtifactFileLayout): void {
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

  recordSyncedContent(filePath: string, content: string): void {
    this.lastWrittenContent.set(path.resolve(filePath), content)
  }

  // 仅更新 .state/ 索引元数据而不改写磁盘源文件（用于外部目录重命名保 ID 同步）
  async updateIndexOnly(artifact: Artifact): Promise<void> {
    this.assertOwnedProject(artifact.projectId)
    const nextLayout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    const previous = this.inner.findByPublicIdSync(artifact.publicId)
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
    this.reservedDirs.set(resolveRealPathAllowMissing(nextLayout.artifactDir), artifact.publicId)
    await this.inner.saveArtifact(artifact)
  }

  private retireObsoleteLayout(previous: Artifact, nextArtifactDir: string): void {
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

  private syncToDisk(artifact: Artifact, source: string): ArtifactFileLayout {
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

    const idBody = `${artifact.publicId}\n`
    if (!fs.existsSync(layout.idFile) || fs.readFileSync(layout.idFile, 'utf8') !== idBody) {
      writeFileAtomic(layout.idFile, idBody)
    }

    return { ...layout, entryFile }
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    const staged = this.pendingVersions.get(artifact.publicId)
    this.pendingVersions.delete(artifact.publicId)
    const stagedForHead = staged && staged.version === artifact.headVersion ? staged : undefined

    this.assertOwnedProject(artifact.projectId)
    const layout = resolveArtifactFileLayout(
      this.artifactsRoot,
      artifact.type,
      artifact.slug,
      stagedForHead?.source,
    )
    // 以下校验、外部未同步改动对账、占位与 SQLite 原子提交全同步执行，避免并发别名碰撞或静默覆写外部编辑
    this.assertNoPhysicalDirCollisionSync(artifact, layout)
    const previous = this.inner.findByPublicIdSync(artifact.publicId)
    if (previous && stagedForHead) {
      this.reconcilePendingDiskEditBeforeWrite(previous, stagedForHead)
    }
    const targetDir = resolveRealPathAllowMissing(layout.artifactDir)
    this.reservedDirs.set(targetDir, artifact.publicId)

    try {
      this.inner.saveArtifactWithVersionSync(artifact, stagedForHead)
    } catch (err) {
      if (!previous) {
        this.reservedDirs.delete(targetDir)
      }
      throw err
    }

    const headVer =
      stagedForHead ?? (await this.inner.getVersion(artifact.publicId, artifact.headVersion))
    if (!headVer) return
    const written = this.syncToDisk(artifact, headVer.source)
    if (previous) {
      this.retireObsoleteLayout(previous, written.artifactDir)
    }
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

  async appendVersion(version: Readonly<Version>): Promise<void> {
    const artifact = await this.inner.findByPublicId(version.artifactId)
    if (artifact) {
      this.assertOwnedProject(artifact.projectId)
      // v2+ 更新：先暂存版本，等待随后的 saveArtifact 使用更新后的 type/slug 校验并原子提交；
      // 若目录碰撞或校验失败，versions 表不会残留孤儿行阻塞后续写入。
      if (version.version > artifact.headVersion) {
        this.pendingVersions.set(artifact.publicId, version)
        return
      }
      resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug, version.source)
    }
    await this.inner.appendVersion(version)
    // 新建 v1（saveArtifact 先于 appendVersion，此时 version === headVersion）立即落盘原生文件
    if (artifact && version.version === artifact.headVersion) {
      this.syncToDisk(artifact, version.source)
    }
  }

  getVersions(artifactId: PublicId): Promise<readonly Readonly<Version>[]> {
    return this.inner.getVersions(artifactId)
  }

  getVersion(artifactId: PublicId, version: number): Promise<Readonly<Version> | undefined> {
    return this.inner.getVersion(artifactId, version)
  }
}

export interface FsArtifactsStorageOptions {
  artifactsRoot: string
  // 该存储绑定的业务项目根目录（独立于 artifactsRoot，兼容 --artifacts-dir 指向子目录或外部缓存路径）
  projectRoot?: string
  // 绑定当前 .artifacts/ 根目录的项目 ID；缺省时沿用已登记的同根目录项目或回退为 'default'
  projectId?: string
}

// 项目内 .artifacts/ 原生文件存储适配器：
// - 源码按 <type>/<slug>/<entry> 原生文件落盘并附 .artifact-id 稳定标识（可纳入 Git、支持宿主直接编辑）；
// - 评论、轮次、回执、状态流与版本索引由服务端独占存放在 .artifacts/.state/state.db，彻底避免与源码编辑冲突。
export class FsArtifactsStorage {
  readonly artifactsRoot: string
  readonly projectRoot: string
  readonly projectId: string
  readonly stateDir: string
  readonly stateDbPath: string
  private readonly sqlite: SqliteStorage
  readonly projects: ProjectRepository
  readonly artifacts: FsArtifactRepository
  readonly states: StateRepository
  readonly rounds: RoundRepository
  readonly feedbacks: FeedbackRepository
  readonly receipts: ReceiptRepository

  constructor(options: FsArtifactsStorageOptions) {
    this.artifactsRoot = path.resolve(options.artifactsRoot)
    this.projectRoot = path.resolve(options.projectRoot ?? path.dirname(this.artifactsRoot))
    this.stateDir = path.join(this.artifactsRoot, STATE_DIR_NAME)
    this.stateDbPath = path.join(this.stateDir, 'state.db')

    fs.mkdirSync(this.stateDir, { recursive: true })
    this.sqlite = new SqliteStorage(this.stateDbPath)

    let resolvedProjectId = options.projectId
    if (!resolvedProjectId) {
      const existingRow = this.sqlite.db
        .prepare('SELECT id FROM projects WHERE root_path = ?')
        .get(this.projectRoot) as { id: string } | undefined
      resolvedProjectId = existingRow?.id ?? 'default'
    }
    this.projectId = resolvedProjectId

    // 登记实际业务项目根目录（而非简单取 artifactsRoot 父目录），使 --artifacts-dir 位于嵌套/外部目录时宿主按 projectDir 登记仍命中同一 projectId
    this.sqlite.db
      .prepare(
        `INSERT OR IGNORE INTO projects (id, root_path, name, last_active_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        this.projectId,
        this.projectRoot,
        path.basename(this.projectRoot) || this.projectId,
        new Date().toISOString(),
      )

    this.projects = this.sqlite.projects
    this.artifacts = new FsArtifactRepository(
      this.artifactsRoot,
      this.projectId,
      this.sqlite.artifacts,
    )
    this.states = this.sqlite.states
    this.rounds = this.sqlite.rounds
    this.feedbacks = this.sqlite.feedbacks
    this.receipts = this.sqlite.receipts
  }

  getEventSeq(): number {
    return this.sqlite.getEventSeq()
  }

  setEventSeq(seq: number): void {
    this.sqlite.setEventSeq(seq)
  }

  findProjectIdByArtifactSync(publicId: PublicId): string | undefined {
    return this.sqlite.findProjectIdByArtifactSync(publicId)
  }

  close(): void {
    this.sqlite.close()
  }
}
