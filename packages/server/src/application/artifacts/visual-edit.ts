import { applyVisualEdit, inspectVisualTarget, VisualEditError } from '@akasha/jsx-source/edit'
import type { Artifact, Author, EditOp, Version } from '@akasha/protocol'
import { stabilizeArtboardSource } from '@akasha/protocol'
import { assertBaseVersion, createImmutableVersion } from '../../domain/artifact/index.js'
import { DomainError, NotFoundError } from '../../domain/errors.js'
import type {
  ArtifactRepository,
  Clock,
  FeedbackRepository,
  RealtimePublisher,
} from '../../domain/ports.js'
import { visualBoardSource } from '../artboard-visual-source.js'
import type { ReviewFeedback } from '../review/feedback.js'
import type { ArtifactReference, ResolveArtifact } from './queries.js'
import type { ArtifactWriteLocks } from './write-locks.js'

const VISUAL_EDIT_LABEL = '可视化直改：'
const VISUAL_EDIT_FEEDBACK_PREFIX = 'visualedit'
const VISUAL_UNDO_LABEL = '撤销可视化直改 v'
const VISUAL_EDIT_KIND_LABEL = {
  text: '修改文字',
  className: '调整 Tailwind 类名',
  attr: '修改属性',
  move: '调整兄弟元素顺序',
  remove: '删除元素',
} satisfies Record<EditOp['kind'], string>

interface VisualEditPorts {
  artifacts: Pick<
    ArtifactRepository,
    'appendVersion' | 'findByPublicId' | 'getVersion' | 'getVersions' | 'saveArtifact'
  >
  feedbacks: Pick<FeedbackRepository, 'list'>
  clock: Clock
  realtime: RealtimePublisher
}

export interface VisualEditBase extends ArtifactReference {
  baseVersion: number
}

export type VisualEditCommand = { op: EditOp; boardId?: string } | { undoVersion: number }

/** 直改反馈和版本事件在同一制品写锁中依次发布；只读检查与预览不创建版本。 */
export class ArtifactVisualEdit {
  constructor(
    private readonly deps: VisualEditPorts,
    private readonly resolveArtifact: ResolveArtifact,
    private readonly locks: Pick<ArtifactWriteLocks, 'forArtifact'>,
    private readonly feedback: Pick<ReviewFeedback, 'submitFeedback'>,
  ) {}

  async inspectVisualEdit(input: VisualEditBase & { loc?: string; boardId?: string }) {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const head = await this.visualEditHead(artifact, input.baseVersion)
    if (input.loc) {
      if (input.boardId === undefined)
        return { target: inspectVisualTarget(artifact.type, head.source, input.loc) }
      const board =
        artifact.type === 'artboard'
          ? visualBoardSource(head.source, head.version, input.boardId)
          : null
      return { target: board ? inspectVisualTarget('html', board.html, input.loc) : null }
    }
    return { undoVersion: (await this.findVisualUndo(artifact, head))?.version ?? null }
  }

  async previewVisualEdit(input: VisualEditBase & VisualEditCommand): Promise<string> {
    const artifact = await this.resolveArtifact(input.id, input.projectId)
    const head = await this.visualEditHead(artifact, input.baseVersion)
    return this.visualEditSource(artifact, head, input)
  }

  async visualEdit(input: VisualEditBase & VisualEditCommand & { author: Author }) {
    if (!input.author.startsWith('human:')) {
      throw new DomainError('FORBIDDEN', '可视化直改仅支持人类作者')
    }
    const resolved = await this.resolveArtifact(input.id, input.projectId)
    return this.locks.forArtifact(resolved.publicId, async () => {
      const artifact = await this.deps.artifacts.findByPublicId(resolved.publicId)
      if (!artifact) throw new NotFoundError(`未找到 Artifact "${resolved.publicId}"`)
      const head = await this.visualEditHead(artifact, input.baseVersion)
      const source = await this.visualEditSource(artifact, head, input)
      if (source === head.source) return { artifact, version: head }
      const now = this.deps.clock.now()
      const version = createImmutableVersion({
        artifactId: artifact.publicId,
        version: head.version + 1,
        parentVersion: head.version,
        author: input.author,
        title: artifact.title,
        source,
        createdAt: now,
      })
      const updated = { ...artifact, headVersion: version.version, updatedAt: now }
      await this.deps.artifacts.appendVersion(version, updated.type)
      await this.deps.artifacts.saveArtifact(updated)
      await this.feedback.submitFeedback(
        {
          id: updated.publicId,
          projectId: updated.projectId,
          version: version.version,
          kind: 'edit',
          // loc 属于基准源码；写入新版本后位置可能漂移，不把它当作新版本的图钉。
          body:
            'op' in input
              ? `${VISUAL_EDIT_LABEL}${VISUAL_EDIT_KIND_LABEL[input.op.kind]}（v${head.version}，${input.op.loc}）`
              : `${VISUAL_UNDO_LABEL}${input.undoVersion}`,
          author: input.author,
        },
        VISUAL_EDIT_FEEDBACK_PREFIX,
      )
      await this.deps.realtime.publish(
        { type: 'version.created', artifactId: updated.publicId, version },
        { projectId: updated.projectId },
      )
      return { artifact: updated, version }
    })
  }

  private async visualEditHead(
    artifact: Artifact,
    baseVersion: number,
  ): Promise<Readonly<Version>> {
    if (baseVersion !== artifact.headVersion) {
      assertBaseVersion(
        artifact,
        await this.deps.artifacts.getVersions(artifact.publicId),
        baseVersion,
      )
    }
    const head = await this.deps.artifacts.getVersion(artifact.publicId, artifact.headVersion)
    if (!head) throw new NotFoundError(`缺少头版本 v${artifact.headVersion}`)
    return head
  }

  private async visualEditSource(
    artifact: Artifact,
    head: Readonly<Version>,
    command: VisualEditCommand,
  ): Promise<string> {
    if ('op' in command) {
      try {
        if (command.boardId !== undefined) {
          const allowedKind =
            command.op.kind === 'text' ||
            command.op.kind === 'className' ||
            command.op.kind === 'move' ||
            command.op.kind === 'remove'
          const board =
            artifact.type === 'artboard' && allowedKind
              ? visualBoardSource(head.source, head.version, command.boardId)
              : null
          if (!board) throw new VisualEditError('画板不支持此直改操作，请改用批注')
          return board.replace(applyVisualEdit('html', board.html, command.op))
        }
        return applyVisualEdit(artifact.type, head.source, command.op)
      } catch (error) {
        if (!(error instanceof VisualEditError)) throw error
        throw new DomainError('BAD_REQUEST', error.message, { annotationOnly: true })
      }
    }
    const edited = await this.findVisualUndo(artifact, head)
    if (
      edited?.version !== command.undoVersion ||
      !edited.parentVersion ||
      edited.source !== head.source
    ) {
      throw new DomainError('BAD_REQUEST', '只能撤销当前源码中的最近一次直改')
    }
    const parent = await this.deps.artifacts.getVersion(artifact.publicId, edited.parentVersion)
    if (!parent) throw new NotFoundError(`缺少基准版本 v${edited.parentVersion}`)
    return artifact.type === 'artboard'
      ? stabilizeArtboardSource(parent.source, parent.version)
      : parent.source
  }

  private async findVisualUndo(
    artifact: Artifact,
    head: Readonly<Version>,
  ): Promise<Readonly<Version> | undefined> {
    if (!head.parentVersion || !['react', 'html', 'artboard'].includes(artifact.type))
      return undefined
    const { items } = await this.deps.feedbacks.list({ artifactId: artifact.publicId })
    const editNotes = new Map<number, string>()
    for (const item of items) {
      if (
        item.kind === 'edit' &&
        item.id.startsWith(`${VISUAL_EDIT_FEEDBACK_PREFIX}_`) &&
        item.version <= head.version
      ) {
        editNotes.set(item.version, item.body)
      }
    }
    const versions = await this.deps.artifacts.getVersions(artifact.publicId)
    const stack: Readonly<Version>[] = []
    // 任何普通发布、代码保存或历史回退都会打断直改撤销链。
    for (const version of [...versions].sort((a, b) => a.version - b.version)) {
      if (version.version > head.version) break
      const note = editNotes.get(version.version)
      if (note?.startsWith(VISUAL_EDIT_LABEL)) stack.push(version)
      else if (note === `${VISUAL_UNDO_LABEL}${stack.at(-1)?.version}`) stack.pop()
      else stack.length = 0
    }
    return stack.at(-1)
  }
}
