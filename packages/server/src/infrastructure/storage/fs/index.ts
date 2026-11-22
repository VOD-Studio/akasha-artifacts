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
import { DomainError } from '../../../domain/errors.js'
import type {
  ArtifactRepository,
  FeedbackRepository,
  ProjectRepository,
  ReceiptRepository,
  RoundRepository,
  StateRepository,
} from '../../../domain/ports.js'
import { SqliteStorage } from '../sqlite/index.js'

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

// 解析 Artifact 在 .artifacts/<type>/<slug>/ 下的安全物理路径，严防路径穿越越界。
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
  return {
    artifactDir,
    entryFile: path.join(artifactDir, entryName),
    idFile: path.join(artifactDir, ARTIFACT_ID_FILENAME),
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
  // 仅识别对应 Artifact 类型的标准入口文件名，避免同目录辅助说明文件误触发版本覆盖
  if (!CANONICAL_ENTRY_FILENAMES[type].includes(filename.toLowerCase())) {
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

  constructor(
    private readonly artifactsRoot: string,
    private readonly projectId: string,
    private readonly inner: ArtifactRepository,
  ) {}

  private assertOwnedProject(projectId: string): void {
    if (projectId !== this.projectId) {
      throw new DomainError(
        'BAD_REQUEST',
        `当前 .artifacts/ 文件存储仅绑定项目 "${this.projectId}"，拒绝写入其它项目 "${projectId}"，以避免跨项目覆写原生文件`,
        { expectedProjectId: this.projectId, actualProjectId: projectId },
      )
    }
  }

  private async assertNoPhysicalDirCollision(
    artifact: Artifact,
    layout: ArtifactFileLayout,
  ): Promise<void> {
    if (!fs.existsSync(layout.idFile)) return
    let rawId: string
    try {
      rawId = fs.readFileSync(layout.idFile, 'utf8').trim()
    } catch {
      return
    }
    const parsedId = PublicIdSchema.safeParse(rawId)
    if (!parsedId.success || parsedId.data === artifact.publicId) return

    const owner = await this.inner.findByPublicId(parsedId.data)
    if (!owner) return
    const ownerLayout = resolveArtifactFileLayout(this.artifactsRoot, owner.type, owner.slug)
    if (path.resolve(ownerLayout.artifactDir) === path.resolve(layout.artifactDir)) {
      throw new DomainError(
        'BAD_REQUEST',
        `物理目录 "${layout.normalizedRelativeDir}" 已被 Artifact "${owner.publicId}"（slug: "${owner.slug}"）占用，请使用不同的 slug`,
        { conflictingPublicId: owner.publicId, conflictingSlug: owner.slug },
      )
    }
  }

  isOwnWrite(filePath: string, content: string): boolean {
    const resolved = path.resolve(filePath)
    return this.lastWrittenContent.get(resolved) === content
  }

  recordSyncedContent(filePath: string, content: string): void {
    this.lastWrittenContent.set(path.resolve(filePath), content)
  }

  // 仅更新 .state/ 索引元数据而不改写磁盘源文件（用于外部目录重命名保 ID 同步）
  async updateIndexOnly(artifact: Artifact): Promise<void> {
    this.assertOwnedProject(artifact.projectId)
    resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    await this.inner.saveArtifact(artifact)
  }

  private retireObsoleteLayout(previous: Artifact, nextArtifactDir: string): void {
    const prevLayout = resolveArtifactFileLayout(this.artifactsRoot, previous.type, previous.slug)
    const prevDir = path.resolve(prevLayout.artifactDir)
    if (prevDir === path.resolve(nextArtifactDir)) return
    if (!fs.existsSync(prevDir)) return

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

    // 自底向上回收空目录（绝不删除 artifactsRoot 本身）
    const root = path.resolve(this.artifactsRoot)
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

    this.lastWrittenContent.set(path.resolve(entryFile), source)
    writeFileAtomic(entryFile, source)

    const idBody = `${artifact.publicId}\n`
    if (!fs.existsSync(layout.idFile) || fs.readFileSync(layout.idFile, 'utf8') !== idBody) {
      writeFileAtomic(layout.idFile, idBody)
    }

    return { ...layout, entryFile }
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.assertOwnedProject(artifact.projectId)
    const layout = resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug)
    await this.assertNoPhysicalDirCollision(artifact, layout)
    const previous = await this.inner.findByPublicId(artifact.publicId)
    await this.inner.saveArtifact(artifact)
    const headVer = await this.inner.getVersion(artifact.publicId, artifact.headVersion)
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
      resolveArtifactFileLayout(this.artifactsRoot, artifact.type, artifact.slug, version.source)
    }
    await this.inner.appendVersion(version)
    // 仅在新建 v1（saveArtifact 先于 appendVersion，此时 version === headVersion）时由此处落盘；
    // v2+ 更新会在随后的 saveArtifact(updated) 使用新元数据落盘并清理旧类型目录，避免把新源码错写入旧类型目录。
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
  // 绑定当前 .artifacts/ 根目录的项目 ID；缺省时沿用已登记的同根目录项目或回退为 'default'
  projectId?: string
}

// 项目内 .artifacts/ 原生文件存储适配器：
// - 源码按 <type>/<slug>/<entry> 原生文件落盘并附 .artifact-id 稳定标识（可纳入 Git、支持宿主直接编辑）；
// - 评论、轮次、回执、状态流与版本索引由服务端独占存放在 .artifacts/.state/state.db，彻底避免与源码编辑冲突。
export class FsArtifactsStorage {
  readonly artifactsRoot: string
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
    this.stateDir = path.join(this.artifactsRoot, STATE_DIR_NAME)
    this.stateDbPath = path.join(this.stateDir, 'state.db')

    fs.mkdirSync(this.stateDir, { recursive: true })
    this.sqlite = new SqliteStorage(this.stateDbPath)

    const projectRoot = path.dirname(this.artifactsRoot)
    let resolvedProjectId = options.projectId
    if (!resolvedProjectId) {
      const existingRow = this.sqlite.db
        .prepare('SELECT id FROM projects WHERE root_path = ?')
        .get(projectRoot) as { id: string } | undefined
      resolvedProjectId = existingRow?.id ?? 'default'
    }
    this.projectId = resolvedProjectId

    // 登记当前 .artifacts/ 所属项目根目录，使宿主从同目录调用 POST /api/v1/projects 时自动复用该 projectId
    this.sqlite.db
      .prepare(
        `INSERT OR IGNORE INTO projects (id, root_path, name, last_active_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        this.projectId,
        projectRoot,
        path.basename(projectRoot) || this.projectId,
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
