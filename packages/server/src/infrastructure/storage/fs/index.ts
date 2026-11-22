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
    private readonly inner: ArtifactRepository,
  ) {}

  isOwnWrite(filePath: string, content: string): boolean {
    const resolved = path.resolve(filePath)
    return this.lastWrittenContent.get(resolved) === content
  }

  recordSyncedContent(filePath: string, content: string): void {
    this.lastWrittenContent.set(path.resolve(filePath), content)
  }

  // 仅更新 .state/ 索引元数据而不改写磁盘源文件（用于外部目录重命名保 ID 同步）
  async updateIndexOnly(artifact: Artifact): Promise<void> {
    await this.inner.saveArtifact(artifact)
  }

  private syncToDisk(artifact: Artifact, source: string): void {
    const layout = resolveArtifactFileLayout(
      this.artifactsRoot,
      artifact.type,
      artifact.slug,
      source,
    )
    fs.mkdirSync(layout.artifactDir, { recursive: true })

    // document 类型在 HTML 与 JSON 格式间切换时清理另一份过期入口文件，防止监听器误读旧文件
    if (artifact.type === 'document') {
      const sibling =
        path.basename(layout.entryFile) === 'index.json'
          ? path.join(layout.artifactDir, 'index.html')
          : path.join(layout.artifactDir, 'index.json')
      if (fs.existsSync(sibling)) {
        fs.rmSync(sibling, { force: true })
        this.lastWrittenContent.delete(path.resolve(sibling))
      }
    }

    this.lastWrittenContent.set(path.resolve(layout.entryFile), source)
    writeFileAtomic(layout.entryFile, source)

    const idBody = `${artifact.publicId}\n`
    if (!fs.existsSync(layout.idFile) || fs.readFileSync(layout.idFile, 'utf8') !== idBody) {
      writeFileAtomic(layout.idFile, idBody)
    }
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    await this.inner.saveArtifact(artifact)
    const headVer = await this.inner.getVersion(artifact.publicId, artifact.headVersion)
    if (!headVer) return
    this.syncToDisk(artifact, headVer.source)
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
    await this.inner.appendVersion(version)
    // 兼容新建 v1 时先 saveArtifact 后 appendVersion 的顺序，确保首次发布同样立即落盘原生文件
    const artifact = await this.inner.findByPublicId(version.artifactId)
    if (artifact && version.version >= artifact.headVersion) {
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
}

// 项目内 .artifacts/ 原生文件存储适配器：
// - 源码按 <type>/<slug>/<entry> 原生文件落盘并附 .artifact-id 稳定标识（可纳入 Git、支持宿主直接编辑）；
// - 评论、轮次、回执、状态流与版本索引由服务端独占存放在 .artifacts/.state/state.db，彻底避免与源码编辑冲突。
export class FsArtifactsStorage {
  readonly artifactsRoot: string
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

    this.projects = this.sqlite.projects
    this.artifacts = new FsArtifactRepository(this.artifactsRoot, this.sqlite.artifacts)
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
