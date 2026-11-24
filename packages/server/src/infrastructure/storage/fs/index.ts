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

/** 服务端独占管理的索引目录名；评论、轮次与运行态都在其中，不随源码一起编辑。 */
export const STATE_DIR_NAME = '.state'
/** 制品目录内记录稳定 `publicId` 的文件名；目录改名或 Git 检出后据此找回身份。 */
export const ARTIFACT_ID_FILENAME = '.artifact-id'

// 每种类型的规范入口文件名；监听器只认这些名字，其余文件的变化不触发同步
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

/** 写盘时采用的入口文件名；`document` 按源码是否以 `{` 开头选 JSON 或 HTML。 */
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
  /** 制品目录的绝对路径。 */
  artifactDir: string
  /** 源码入口文件。 */
  entryFile: string
  /** 记录 `publicId` 的文件。 */
  idFile: string
  /** 相对 `.artifacts/` 的目录路径，用作 slug 比对的规范形式。 */
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

/**
 * 校验目标路径及其每一级已存在祖先都落在 `artifactsRoot` 的真实路径之内。
 *
 * @throws {DomainError} 路径字面越界、任一级是符号链接，或真实路径越界；错误码为 `BAD_REQUEST`。
 */
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

/**
 * 解析制品在 `.artifacts/<type>/<slug>/` 下的物理路径，拦截路径穿越与符号链接越界。
 *
 * @throws {DomainError} slug 为空、含 `.`、`..` 或 `.state` 段，或路径越界（`BAD_REQUEST`）。
 */
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
  /** 目录内 `.artifact-id` 的内容；文件缺失或内容不合法时省略。 */
  existingPublicId?: PublicId
}

/**
 * 从 `.artifacts/` 内的物理文件路径反推出类型、slug 与已有的 `publicId`。
 *
 * @returns 不是制品规范入口文件的路径返回 `null`：位于 `.state/` 下、是隐藏或临时文件，
 * 或文件名不在该类型的规范入口名之内。
 */
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

// 先写同目录临时文件再 rename，监听器不会读到写了一半的内容
function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, filePath)
}

/**
 * `ArtifactRepository` 的文件存储实现：源码落盘为原生文件，元数据与版本历史仍存 SQLite。
 *
 * @remarks 每次写入都先做物理目录碰撞校验与外部改动对账，再与 SQLite 在单个同步事务内提交；
 * 校验失败时不落盘、不残留版本行。目录布局与 `.artifact-id` 见 `FsArtifactsStorage`。
 */
export class FsArtifactRepository implements ArtifactRepository {
  // 记录服务端最近一次落盘的源码内容，供文件监听器识别并跳过自写回环
  private readonly lastWrittenContent = new Map<string, string>()
  // 暂存 v2+ 待提交版本：先经 saveArtifact 完成项目归属与物理目录碰撞校验，再与元数据在单事务内原子提交，防止校验拒绝后遗留孤儿版本
  private readonly pendingVersions = new Map<PublicId, Readonly<Version>>()
  // 同步记录已被占用的规范物理目录（防止并发首次发布 card 与 html/card 同时通过校验并互相覆写）
  private readonly reservedDirs = new Map<string, PublicId>()
  // 标记当前正由监听器/全量扫描主动导入的外部新文件，用于区分合法外部导入与会覆写未入库文件的 API 首次发布
  private readonly importingExternalFiles = new Map<string, { slug: Slug; source: string }>()
  private onDiskReconciled?: (artifact: Artifact, version: Readonly<Version>) => void

  constructor(
    private readonly artifactsRoot: string,
    private readonly projectId: string,
    private readonly inner: SqliteArtifactRepository,
  ) {}

  get lifecycle() {
    return this.inner.lifecycle
  }

  get boardProjections() {
    return this.inner.boardProjections
  }

  /** 注册回调：服务端写入前补录了未入库的外部改动时触发，用于把补录的版本广播出去。 */
  setOnDiskReconciled(cb: (artifact: Artifact, version: Readonly<Version>) => void): void {
    this.onDiskReconciled = cb
  }

  /** 标记某文件正由监听器或全量扫描导入，使随后的首次发布不被当作覆写未入库的文件。 */
  markImportingExternalFile(filePath: string, slug: Slug, source: string): void {
    this.importingExternalFiles.set(resolveRealPathAllowMissing(filePath), { slug, source })
  }

  /** 清除导入标记。 */
  clearImportingExternalFile(filePath: string): void {
    this.importingExternalFiles.delete(resolveRealPathAllowMissing(filePath))
  }

  private findExistingDiskEntries(artifact: Artifact): string[] {
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
  private findRelocatedDirByPublicId(publicId: PublicId, excludeDir: string): string | null {
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

  // 在服务端写入覆写磁盘前检查所有规范入口文件（含 document 的 index.html/index.json 与 react 的 index.tsx/index.jsx）：
  // 若存在尚未被防抖监听器捕获的外部磁盘改动，则先把外部修改入库为新版本并抛出 409 VERSION_CONFLICT，绝不静默覆盖或误删。
  private reconcilePendingDiskEditBeforeWrite(
    previous: Artifact,
    stagedForHead: Readonly<Version>,
  ): void {
    const prevHeadVer = this.inner.getVersionSync(previous.publicId, previous.headVersion)
    if (!prevHeadVer) return
    const diskFiles = this.findExistingDiskEntries(previous)
    if (diskFiles.length === 0) {
      // 原目录无规范源文件时，排查是否存在尚未被防抖监听器同步的目录移动（同 .artifact-id 位于新目录），
      // 若已迁往新路径则拒绝在旧路径重建重复副本。
      const prevLayout = resolveArtifactFileLayout(this.artifactsRoot, previous.type, previous.slug)
      const relocatedDir = this.findRelocatedDirByPublicId(
        previous.publicId,
        prevLayout.artifactDir,
      )
      if (relocatedDir) {
        const relMoved = path.relative(path.resolve(this.artifactsRoot), relocatedDir)
        throw new DomainError(
          'VERSION_CONFLICT',
          `检测到 Artifact "${previous.publicId}" 的磁盘目录已迁至 "${relMoved}" 且尚未完成监听同步，拒绝在旧路径重建重复目录`,
          { artifactId: previous.publicId, relocatedDir: relMoved },
        )
      }
      return
    }

    const modifiedEntries: Array<{ file: string; source: string }> = []
    const unmodifiedEntries: string[] = []
    for (const diskFile of diskFiles) {
      let diskSource: string
      try {
        diskSource = fs.readFileSync(diskFile, 'utf8')
      } catch {
        continue
      }
      if (diskSource === prevHeadVer.source) {
        unmodifiedEntries.push(diskFile)
      } else {
        modifiedEntries.push({ file: diskFile, source: diskSource })
      }
    }

    if (modifiedEntries.length === 0) {
      // 即使磁盘与 prevHeadVer 一致，若本次是过时的 agent:fs 监听快照（其内容已不同于当前磁盘文件），也拒绝回写以防覆盖较新版本
      if (stagedForHead.author === 'agent:fs' && stagedForHead.source !== prevHeadVer.source) {
        throw new DomainError(
          'VERSION_CONFLICT',
          '外部文件监听快照已过时，磁盘已包含更新版本内容，已放弃回写',
          { artifactId: previous.publicId, headVersion: previous.headVersion },
        )
      }
      return
    }

    // 若本次写入正是监听器针对唯一变更磁盘快照的同步请求，直接放行
    if (
      modifiedEntries.length === 1 &&
      stagedForHead.author === 'agent:fs' &&
      modifiedEntries[0]?.source === stagedForHead.source
    ) {
      return
    }

    // 多个规范入口文件同时存在未入库外部改动时，拒绝覆盖并不删除任何文件，交由人工清理
    if (modifiedEntries.length > 1) {
      throw new DomainError(
        'BAD_REQUEST',
        `目录中同时存在多个未入库的外部修改入口文件（${modifiedEntries.map((e) => path.basename(e.file)).join('、')}），请先合并或清理后再提交`,
      )
    }

    const changed = modifiedEntries[0]
    if (!changed) return

    const nextExternalVersion = previous.headVersion + 1
    const now = new Date().toISOString()
    const externalVersion = createImmutableVersion({
      artifactId: previous.publicId,
      version: nextExternalVersion,
      parentVersion: previous.headVersion,
      author: 'agent:fs',
      title: previous.title,
      source: changed.source,
      createdAt: now,
    })
    const reconciledArtifact: Artifact = {
      ...previous,
      headVersion: nextExternalVersion,
      updatedAt: now,
    }
    this.inner.saveArtifactWithVersionSync(reconciledArtifact, externalVersion)

    // 仅清理与已归档 prevHeadVer 完全一致的旧同伴入口文件，防止重启对账回滚，且绝不删除任何未入库外部改动
    for (const oldFile of unmodifiedEntries) {
      if (fs.existsSync(oldFile)) {
        fs.rmSync(oldFile, { force: true })
        this.lastWrittenContent.delete(path.resolve(oldFile))
      }
    }

    this.recordSyncedContent(changed.file, changed.source)
    this.onDiskReconciled?.(reconciledArtifact, externalVersion)

    throw new VersionConflictError({
      artifactId: previous.publicId,
      baseVersion: previous.headVersion,
      headVersion: nextExternalVersion,
      diff: computeUnifiedDiff(
        prevHeadVer.source,
        changed.source,
        `v${previous.headVersion}`,
        `v${nextExternalVersion}`,
      ),
      authors: ['agent:fs'],
    })
  }

  // 首次发布或启动期导入前检查目标物理目录的全部规范入口文件：
  // - 若存在多个内容不同的规范入口（如同时存在 document 的 index.html 与 index.json），拒绝导入/覆写且不删除任何文件；
  // - 若仅存在单个未入库外部源文件（且非当前监听器导入），先补录为 v1 并抛出 409 VERSION_CONFLICT。
  private reconcileUnindexedDiskFileBeforeCreate(
    artifact: Artifact,
    layout: ArtifactFileLayout,
  ): void {
    const existingDiskFiles = this.findExistingDiskEntries(artifact)
    if (existingDiskFiles.length === 0) return

    const entries: Array<{ file: string; source: string }> = []
    for (const file of existingDiskFiles) {
      try {
        entries.push({ file, source: fs.readFileSync(file, 'utf8') })
      } catch {
        // 忽略不可读文件
      }
    }
    if (entries.length === 0) return

    if (new Set(entries.map((e) => e.source)).size > 1) {
      throw new DomainError(
        'BAD_REQUEST',
        `目标目录 "${layout.normalizedRelativeDir}" 同时存在多个内容不同的规范入口文件（${entries.map((e) => path.basename(e.file)).join('、')}），请保留唯一入口文件后再导入或发布`,
      )
    }

    for (const entry of entries) {
      const importing = this.importingExternalFiles.get(resolveRealPathAllowMissing(entry.file))
      if (importing && importing.slug === artifact.slug && importing.source === entry.source) {
        return
      }
    }

    const primary = entries[0]
    if (!primary) return
    const existingDiskFile = primary.file
    const diskSource = primary.source

    let reconciledId = artifact.publicId
    if (fs.existsSync(layout.idFile)) {
      try {
        const parsedId = PublicIdSchema.safeParse(fs.readFileSync(layout.idFile, 'utf8').trim())
        if (parsedId.success && !this.inner.findByPublicIdSync(parsedId.data)) {
          reconciledId = parsedId.data
        }
      } catch {
        // 忽略读取异常，回退使用新生成的 publicId
      }
    }

    const now = new Date().toISOString()
    const externalV1 = createImmutableVersion({
      artifactId: reconciledId,
      version: 1,
      parentVersion: null,
      author: 'agent:fs',
      title: artifact.title,
      source: diskSource,
      createdAt: now,
    })
    const reconciledArtifact: Artifact = {
      ...artifact,
      publicId: reconciledId,
      headVersion: 1,
      createdAt: now,
      updatedAt: now,
    }
    const targetDir = resolveRealPathAllowMissing(layout.artifactDir)
    this.reservedDirs.set(targetDir, reconciledId)
    this.inner.saveArtifactWithVersionSync(reconciledArtifact, externalV1)

    const idBody = `${reconciledId}\n`
    assertRealPathInsideRoot(this.artifactsRoot, layout.idFile)
    if (!fs.existsSync(layout.idFile) || fs.readFileSync(layout.idFile, 'utf8') !== idBody) {
      writeFileAtomic(layout.idFile, idBody)
    }
    this.recordSyncedContent(existingDiskFile, diskSource)
    this.onDiskReconciled?.(reconciledArtifact, externalV1)

    throw new DomainError(
      'VERSION_CONFLICT',
      `版本冲突：目标目录 "${layout.normalizedRelativeDir}" 已存在尚未入库的外部源文件，已自动补录为 v1，请先拉取 v1 再基于 baseVersion=1 合并提交`,
      {
        artifactId: reconciledId,
        headVersion: 1,
        diff: computeUnifiedDiff('', diskSource, 'v0', 'v1'),
        authors: ['agent:fs'],
      },
    )
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

  /**
   * 只更新索引里的目录元数据（slug、type、updatedAt），不改写磁盘上的源文件。
   *
   * @remarks 内部重读最新记录并保留既有 `headVersion`，防止与并发的发布或更新交错时回退版本号。
   */
  async updateIndexOnly(artifact: Artifact): Promise<Artifact> {
    this.assertOwnedProject(artifact.projectId)
    const nextLayout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    const previous = this.inner.findByPublicIdSync(artifact.publicId)
    const merged: Artifact = previous
      ? {
          ...previous,
          slug: artifact.slug,
          type: artifact.type,
          updatedAt: artifact.updatedAt,
        }
      : artifact
    // 变更目录索引前同样执行物理目录占用校验，防止移入已被短 slug（如 card）占用的同一物理目录
    this.assertNoPhysicalDirCollisionSync(merged, nextLayout)
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
    this.reservedDirs.set(resolveRealPathAllowMissing(nextLayout.artifactDir), merged.publicId)
    await this.inner.saveArtifact(merged)
    return merged
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

  /**
   * 保存制品元数据；该制品有待提交的新版本时，与它一起原子提交并把源码落盘。
   *
   * @remarks `appendVersion` 对 v2 及之后的版本只暂存，真正的落盘发生在这里。
   */
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
    const targetDir = resolveRealPathAllowMissing(layout.artifactDir)
    if (previous && stagedForHead) {
      this.reconcilePendingDiskEditBeforeWrite(previous, stagedForHead)
      // 类型或布局迁移到新物理目录时，若目标目录已存在未入库的外部源文件，拒绝覆写以保护外部修改
      const prevLayout = resolveArtifactFileLayout(this.artifactsRoot, previous.type, previous.slug)
      const prevDir = resolveRealPathAllowMissing(prevLayout.artifactDir)
      if (prevDir !== targetDir) {
        const destDiskFiles = this.findExistingDiskEntries(artifact)
        if (destDiskFiles.length > 0) {
          if (destDiskFiles.length > 1) {
            throw new DomainError(
              'BAD_REQUEST',
              `目标物理目录 "${layout.normalizedRelativeDir}" 已存在多个未入库的外部源文件，拒绝迁移覆写`,
              { destinationDir: layout.normalizedRelativeDir },
            )
          }
          const destDiskFile = destDiskFiles[0]
          if (destDiskFile) {
            let destSource: string | undefined
            try {
              destSource = fs.readFileSync(destDiskFile, 'utf8')
            } catch {
              destSource = undefined
            }
            const isWatcherOwnMigration =
              stagedForHead.author === 'agent:fs' && destSource === stagedForHead.source
            const importing = this.importingExternalFiles.get(
              resolveRealPathAllowMissing(destDiskFile),
            )
            if (
              !isWatcherOwnMigration &&
              !(importing && importing.slug === artifact.slug && importing.source === destSource)
            ) {
              throw new DomainError(
                'BAD_REQUEST',
                `目标物理目录 "${layout.normalizedRelativeDir}" 已存在尚未入库的外部源文件，拒绝迁移覆写`,
                { destinationDir: layout.normalizedRelativeDir },
              )
            }
          }
        }
      }
    } else if (!previous) {
      this.reconcileUnindexedDiskFileBeforeCreate(artifact, layout)
    }
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
      this.assertOwnedProject(artifact.projectId)
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
      this.syncToDisk(artifact, version.source)
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

export interface FsArtifactsStorageOptions {
  artifactsRoot: string
  // 该存储绑定的业务项目根目录（独立于 artifactsRoot，兼容 --artifacts-dir 指向子目录或外部缓存路径）
  projectRoot?: string
  // 缺省时依次取同根目录已登记的项目、meta 里的记录、最近活跃的项目，最后回退为 default
  projectId?: string
}

/**
 * 项目内 `.artifacts/` 原生文件存储适配器。
 *
 * @remarks 源码按 `<type>/<slug>/<入口文件>` 落盘并附 `.artifact-id` 稳定标识，可纳入 Git、
 * 也可由宿主直接编辑。评论、轮次、回执、状态流与版本索引由服务端独占存放在
 * `.artifacts/.state/state.db`，不与源码编辑冲突。
 */
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
  readonly artifactStorage: SqliteStorage['artifactStorage']

  constructor(options: FsArtifactsStorageOptions) {
    this.artifactsRoot = path.resolve(options.artifactsRoot)
    this.projectRoot = path.resolve(options.projectRoot ?? path.dirname(this.artifactsRoot))
    this.stateDir = path.join(this.artifactsRoot, STATE_DIR_NAME)
    this.stateDbPath = path.join(this.stateDir, 'state.db')

    fs.mkdirSync(this.stateDir, { recursive: true })
    this.sqlite = new SqliteStorage(this.stateDbPath)

    let resolvedProjectId = options.projectId
    if (!resolvedProjectId) {
      const byRoot = this.sqlite.db
        .prepare('SELECT id FROM projects WHERE root_path = ?')
        .get(this.projectRoot) as { id: string } | undefined
      const byMeta = this.sqlite.db
        .prepare("SELECT value FROM meta WHERE key = 'fs_project_id'")
        .get() as { value: string } | undefined
      const fallbackExisting = this.sqlite.db
        .prepare('SELECT id FROM projects ORDER BY last_active_at DESC LIMIT 1')
        .get() as { id: string } | undefined
      resolvedProjectId = byRoot?.id ?? byMeta?.value ?? fallbackExisting?.id ?? 'default'
    }
    this.projectId = resolvedProjectId

    // 登记并刷新当前 .artifacts/ 所属项目的最新根目录（兼容项目目录整体改名/迁移后保留原 projectId，确保宿主按新 projectDir 登记命中同一项目）
    this.sqlite.db.exec('BEGIN IMMEDIATE')
    try {
      this.sqlite.db
        .prepare('DELETE FROM projects WHERE root_path = ? AND id != ?')
        .run(this.projectRoot, this.projectId)
      this.sqlite.db
        .prepare(
          `INSERT INTO projects (id, root_path, name, last_active_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             root_path = excluded.root_path,
             name = excluded.name,
             last_active_at = excluded.last_active_at`,
        )
        .run(
          this.projectId,
          this.projectRoot,
          path.basename(this.projectRoot) || this.projectId,
          new Date().toISOString(),
        )
      this.sqlite.db
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('fs_project_id', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(this.projectId)
      this.sqlite.db.exec('COMMIT')
    } catch (err) {
      this.sqlite.db.exec('ROLLBACK')
      throw err
    }

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
    this.artifactStorage = this.sqlite.artifactStorage
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
