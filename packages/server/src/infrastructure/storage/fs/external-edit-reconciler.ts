import fs from 'node:fs'
import path from 'node:path'
import { type Artifact, PublicIdSchema, type Slug, type Version } from '@akasha/protocol'
import { createImmutableVersion } from '../../../domain/artifact/index.js'
import { computeUnifiedDiff } from '../../../domain/diff.js'
import { DomainError, VersionConflictError } from '../../../domain/errors.js'
import type { SqliteArtifactRepository } from '../sqlite/index.js'
import type { ArtifactWorkingTree } from './artifact-working-tree.js'
import {
  type ArtifactFileLayout,
  assertRealPathInsideRoot,
  resolveArtifactFileLayout,
  resolveRealPathAllowMissing,
} from './file-layout.js'

/** 在同步写入窗口内补录外部版本，或拒绝会覆盖尚未入库源码的写入。 */
export class ExternalEditReconciler {
  // 标记当前正由监听器/全量扫描主动导入的外部新文件，用于区分合法外部导入与会覆写未入库文件的 API 首次发布
  private readonly importingExternalFiles = new Map<string, { slug: Slug; source: string }>()
  private onDiskReconciled?: (artifact: Artifact, version: Readonly<Version>) => void

  constructor(
    private readonly files: ArtifactWorkingTree,
    private readonly inner: SqliteArtifactRepository,
  ) {}

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

  reconcileBeforeWrite(
    artifact: Artifact,
    layout: ArtifactFileLayout,
    targetDir: string,
    previous: Artifact | undefined,
    stagedForHead: Readonly<Version> | undefined,
  ): void {
    if (!previous) {
      this.reconcileUnindexedDiskFileBeforeCreate(artifact, layout)
      return
    }
    if (!stagedForHead) return
    this.reconcilePendingDiskEditBeforeWrite(previous, stagedForHead)

    // 类型或布局迁移时，不允许服务端覆写目标目录内未入库的外部源文件。
    const previousLayout = resolveArtifactFileLayout(
      this.files.artifactsRoot,
      previous.type,
      previous.slug,
    )
    if (resolveRealPathAllowMissing(previousLayout.artifactDir) === targetDir) return
    const entries = this.files.findExistingDiskEntries(artifact)
    if (entries.length > 1) {
      throw new DomainError(
        'BAD_REQUEST',
        `目标物理目录 "${layout.normalizedRelativeDir}" 已存在多个未入库的外部源文件，拒绝迁移覆写`,
        { destinationDir: layout.normalizedRelativeDir },
      )
    }
    const file = entries[0]
    if (!file) return
    let source: string | undefined
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      // 不能确认内容一致时，不允许以监听器快照为依据覆盖。
    }
    const watcherMigration = stagedForHead.author === 'agent:fs' && source === stagedForHead.source
    const importing = this.importingExternalFiles.get(resolveRealPathAllowMissing(file))
    if (
      !watcherMigration &&
      !(importing && importing.slug === artifact.slug && importing.source === source)
    ) {
      throw new DomainError(
        'BAD_REQUEST',
        `目标物理目录 "${layout.normalizedRelativeDir}" 已存在尚未入库的外部源文件，拒绝迁移覆写`,
        { destinationDir: layout.normalizedRelativeDir },
      )
    }
  }

  // 在服务端写入覆写磁盘前检查所有规范入口文件（含 document 的 index.html/index.json 与 react 的 index.tsx/index.jsx）：
  // 若存在尚未被防抖监听器捕获的外部磁盘改动，则先把外部修改入库为新版本并抛出 409 VERSION_CONFLICT，绝不静默覆盖或误删。
  private reconcilePendingDiskEditBeforeWrite(
    previous: Artifact,
    stagedForHead: Readonly<Version>,
  ): void {
    const prevHeadVer = this.inner.getVersionSync(previous.publicId, previous.headVersion)
    if (!prevHeadVer) return
    const diskFiles = this.files.findExistingDiskEntries(previous)
    if (diskFiles.length === 0) {
      // 原目录无规范源文件时，排查是否存在尚未被防抖监听器同步的目录移动（同 .artifact-id 位于新目录），
      // 若已迁往新路径则拒绝在旧路径重建重复副本。
      const prevLayout = resolveArtifactFileLayout(
        this.files.artifactsRoot,
        previous.type,
        previous.slug,
      )
      const relocatedDir = this.files.findRelocatedDirByPublicId(
        previous.publicId,
        prevLayout.artifactDir,
      )
      if (relocatedDir) {
        const relMoved = path.relative(path.resolve(this.files.artifactsRoot), relocatedDir)
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
    if (previous.type === 'design-system') {
      throw new DomainError(
        'RESOURCE_CONFLICT',
        '设计系统的磁盘副本已修改，请在审阅面板重新导入；未发布外部改动',
      )
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
        this.files.forgetSyncedContent(oldFile)
      }
    }

    this.files.recordSyncedContent(changed.file, changed.source)
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
    const existingDiskFiles = this.files.findExistingDiskEntries(artifact)
    if (existingDiskFiles.length === 0) return
    if (artifact.type === 'design-system') {
      throw new DomainError(
        'RESOURCE_CONFLICT',
        '目标目录内已有未经审阅的设计系统；未发布或覆盖磁盘文件',
      )
    }

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
    this.files.reserve(targetDir, reconciledId)
    this.inner.saveArtifactWithVersionSync(reconciledArtifact, externalV1)

    assertRealPathInsideRoot(this.files.artifactsRoot, layout.idFile)
    this.files.writeIdentity(layout, reconciledId)
    this.files.recordSyncedContent(existingDiskFile, diskSource)
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
}
