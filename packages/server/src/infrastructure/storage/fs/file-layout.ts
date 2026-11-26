import fs from 'node:fs'
import path from 'node:path'
import {
  type ArtifactType,
  ArtifactTypeSchema,
  type PublicId,
  PublicIdSchema,
  type Slug,
} from '@akasha/protocol'
import { DomainError } from '../../../domain/errors.js'

/** 服务端独占管理的索引目录名；评论、轮次与运行态都在其中，不随源码一起编辑。 */
export const STATE_DIR_NAME = '.state'
/** 制品目录内记录稳定 `publicId` 的文件名；目录改名或 Git 检出后据此找回身份。 */
export const ARTIFACT_ID_FILENAME = '.artifact-id'

/** 监听器只认各类型的规范入口名，其余文件变化不触发同步。 */
export const CANONICAL_ENTRY_FILENAMES: Record<ArtifactType, readonly string[]> = {
  react: ['index.tsx', 'index.jsx'],
  html: ['index.html'],
  markdown: ['index.md'],
  mermaid: ['diagram.mmd'],
  svg: ['graphic.svg'],
  document: ['index.html', 'index.json'],
  artboard: ['index.json'],
  'design-system': ['index.json'],
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

/** 对尚未创建的路径只解析已存在祖先的真实位置。 */
export function resolveRealPathAllowMissing(targetPath: string): string {
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
