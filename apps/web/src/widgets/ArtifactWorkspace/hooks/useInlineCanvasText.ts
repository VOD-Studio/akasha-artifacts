import {
  type Artifact,
  DESIGN_LAYER_BLOCK_PREFIX,
  type DesignLayer,
  type ElementRef,
  type SandboxToShellMessage,
  type VersionSummary,
} from '@akasha/protocol'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  type CanvasBoard,
  type CanvasTextTarget,
  canvasTextDraftKey,
  discardCanvasTextDraft,
  moveCanvasTextDraft,
  readCanvasTextDraft,
  writeCanvasTextDraft,
} from '@/entities/artifact'
import { fetchVisualEditTarget, previewVisualEdit } from '@/features/visual-edit'
import type { ShellOutgoingPayload } from '@/shared/bridge/host'
import type { Point } from '../lib/canvas-camera'
import type { CanvasBoardEditing } from './useCanvasBoardEditing'

/** 有纯文本正文的原生设计对象。 */
export type DesignTextLayer = Extract<DesignLayer, { kind: 'text' | 'note' }>

/** 画布只提交像素位置或新对象；命中、源码检查与发布由工作区编排。 */
export interface CanvasTextTools {
  /** 命中点是画板像素，锚点是外壳屏幕坐标，二者不能混用。 */
  pick: (board: CanvasBoard, point: Point, anchor: Point) => void
  /** 放置新对象时保留指针按下时的源码版本。 */
  place: (board: CanvasBoard, layer: DesignTextLayer, base: VersionSummary, anchor: Point) => void
  /** 检查器可从已选文字对象直接进入同一编辑器。 */
  edit: (board: CanvasBoard, layer: DesignTextLayer, anchor: Point) => void
  /** 选区工具栏可从已验证的静态源码文字直接进入同一编辑器。 */
  editSource: (board: CanvasBoard, loc: string, text: string, anchor: Point) => void
}

/** 一个已定位的编辑或只读提示，保留打开时的版本和外壳定位。 */
export type CanvasTextDraft = { anchor: Point; base: VersionSummary } & (
  | (CanvasTextTarget & { restoredText?: string })
  | { kind: 'readOnly'; element: ElementRef; message: string }
)

type TextTarget = Extract<SandboxToShellMessage, { type: 'inspect.target' }>
interface Request {
  id: string
  board: CanvasBoard
  base: VersionSummary
  anchor: Point
}
interface TextEditingInput {
  artifact: Artifact
  version: VersionSummary
  enabled: boolean
  writable: boolean
  shareExpiresAt?: string
  activeBoardId?: string
  editing: CanvasBoardEditing
  readBoard: (board: CanvasBoard) => CanvasBoard | undefined
  send: (boardId: string, message: ShellOutgoingPayload) => void
  annotate: (element: ElementRef) => void
}

/** 只处理最新一次双击请求；用户输入始终以打开时的快照为基准。 */
export function useInlineCanvasText(input: TextEditingInput) {
  const draftKey = (base: VersionSummary) =>
    canvasTextDraftKey(input.artifact.projectId, base, input.shareExpiresAt)
  const [openDraft, setDraft] = useState<CanvasTextDraft | null>(null)
  const draft =
    openDraft?.base.artifactId === input.artifact.publicId &&
    openDraft.base.version === input.version.version
      ? openDraft
      : null
  // 作品与授权未变时保留编辑器；跨项目只迁移仍有写权限的当前快照。
  const project = input.artifact.projectId
  const previousProject = useRef(project)
  useLayoutEffect(() => {
    const from = previousProject.current
    previousProject.current = project
    if (from === project || !input.writable) return
    moveCanvasTextDraft(
      canvasTextDraftKey(from, input.version, input.shareExpiresAt),
      canvasTextDraftKey(project, input.version, input.shareExpiresAt),
    )
  }, [project, input.writable, input.version, input.shareExpiresAt])
  // 可能先在源码或固定版本中挂载；首次可编辑时才读取，已在编辑的正文优先。
  const restored = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!input.enabled) return
    const key = canvasTextDraftKey(project, input.version, input.shareExpiresAt)
    if (restored.current === key) return
    restored.current = key
    if (draft) return
    const saved = readCanvasTextDraft(key)
    if (saved) {
      setDraft({
        ...saved.target,
        base: input.version,
        restoredText: saved.value,
        anchor: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      })
    }
  }, [project, input.version, input.shareExpiresAt, input.enabled, draft])
  const pending = useRef<Request | null>(null)
  const remembered = useRef<{ draft: CanvasTextDraft; value: string } | null>(null)
  const latest = useRef({ ...input, draft })
  latest.current = { ...input, draft }

  const onTextTarget = useCallback(async (boardId: string, message: TextTarget) => {
    const request = pending.current
    const current = latest.current
    if (
      !request ||
      request.id !== message.requestId ||
      request.board.id !== boardId ||
      request.base.version !== message.version ||
      current.activeBoardId !== boardId ||
      request.base.artifactId !== current.artifact.publicId ||
      current.version.version !== message.version ||
      current.draft ||
      !current.enabled
    )
      return
    const { element, loc } = message
    if (!element) {
      pending.current = null
      return
    }
    const { board, base, anchor } = request
    const finish = (next: CanvasTextDraft) => {
      const live = latest.current
      if (pending.current !== request) return
      pending.current = null
      if (
        live.activeBoardId === boardId &&
        !live.draft &&
        live.enabled &&
        live.artifact.publicId === base.artifactId &&
        live.version.version === base.version
      )
        setDraft(next)
    }
    const blockId = element.blockId
    if (blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) {
      const id = blockId.slice(DESIGN_LAYER_BLOCK_PREFIX.length)
      const layer = board.designLayers?.find((item) => item.id === id)
      if (layer?.kind === 'text' || layer?.kind === 'note') {
        finish({ kind: 'native', boardId, anchor, base, layer })
        return
      }
    }
    const sourceBoard = board.scoped ? boardId : undefined
    if (loc && !board.generated) {
      try {
        const { target } = await fetchVisualEditTarget(base.artifactId, {
          project: current.artifact.projectId,
          baseVersion: base.version,
          boardId: sourceBoard,
          loc,
        })
        if (target?.text !== undefined && target.text !== null) {
          finish({ kind: 'source', boardId: sourceBoard, anchor, base, loc, text: target.text })
          return
        }
      } catch (cause) {
        finish({
          kind: 'readOnly',
          base,
          element,
          anchor,
          message: cause instanceof Error ? cause.message : '无法检查文字',
        })
        return
      }
    }
    finish({
      kind: 'readOnly',
      base,
      element,
      anchor,
      message: '无法定位可编辑的静态文字。',
    })
  }, [])

  const tools: CanvasTextTools = {
    pick(board, point, anchor) {
      if (draft || !input.enabled || !input.editing.available) return
      const loaded = input.readBoard(board)
      if (!loaded) return
      const id = crypto.randomUUID()
      pending.current = { id, board: loaded, anchor, base: input.version }
      input.send(board.id, {
        type: 'inspect.at',
        purpose: 'text',
        requestId: id,
        version: input.version.version,
        x: point.x,
        y: point.y,
      })
    },
    place(board, layer, base, anchor) {
      if (draft || !input.enabled || !input.editing.available) return
      pending.current = null
      setDraft({ kind: 'create', boardId: board.id, anchor, base, layer })
    },
    edit(board, layer, anchor) {
      if (draft || !input.enabled || !input.editing.available) return
      pending.current = null
      setDraft({ kind: 'native', boardId: board.id, anchor, base: input.version, layer })
    },
    editSource(board, loc, text, anchor) {
      if (draft || !input.enabled || !input.editing.available) return
      pending.current = null
      setDraft({
        kind: 'source',
        boardId: board.scoped ? board.id : undefined,
        anchor,
        base: input.version,
        loc,
        text,
      })
    },
  }

  return {
    tools,
    draft: input.enabled ? draft : null,
    initialText:
      draft && remembered.current?.draft === draft ? remembered.current.value : undefined,
    onTextTarget,
    remember(text: string) {
      if (!draft || draft.kind === 'readOnly' || !input.enabled) return
      remembered.current = { draft, value: text }
      const key = draftKey(draft.base)
      const original = draft.kind === 'source' ? draft.text : draft.layer.text
      if (text === original) discardCanvasTextDraft(key)
      else writeCanvasTextDraft(key, draft, text)
    },
    close() {
      if (draft && draft.kind !== 'readOnly') discardCanvasTextDraft(draftKey(draft.base))
      setDraft(null)
    },
    annotate(element: ElementRef) {
      input.annotate(element)
      setDraft(null)
    },
    async save(text: string) {
      if (!draft || draft.kind === 'readOnly') return
      if (!input.editing.available) throw new Error('当前无法保存文字，输入已保留。')
      const { base } = draft
      const key = draftKey(base)
      const clearSavedText = () => discardCanvasTextDraft(key)
      let staged: boolean
      if (draft.kind === 'source') {
        const { source } = await previewVisualEdit(base.artifactId, {
          project: input.artifact.projectId,
          baseVersion: base.version,
          boardId: draft.boardId,
          op: { kind: 'text', loc: draft.loc, value: text },
        })
        const live = latest.current
        if (live.draft !== draft || !live.enabled || live.artifact.publicId !== base.artifactId)
          return
        staged = await live.editing.replaceSource(source, base, clearSavedText)
      } else if (draft.kind === 'native') {
        staged = await input.editing.change(
          { kind: 'layerText', boardId: draft.boardId, layerId: draft.layer.id, text },
          base,
          clearSavedText,
        )
      } else {
        staged = await input.editing.change(
          { kind: 'layerCreate', boardId: draft.boardId, layer: { ...draft.layer, text } },
          base,
          clearSavedText,
        )
      }
      if (!staged) throw new Error('无法保存文字，请处理画布上的提示后重试。')
      setDraft(null)
    },
  }
}
