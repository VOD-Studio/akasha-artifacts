import {
  type AnnotationThread,
  type ArtifactWorkspaceDetail,
  DESIGN_LAYER_BLOCK_PREFIX,
  type DesignLayer,
  type ElementRef,
  type Feedback,
  isAnnotationKind,
  type JsonPatchOp,
  type ReviewRound,
  type SandboxToShellMessage,
  STANDALONE_BOARD_ID,
  type Version,
  type VersionSummary,
} from '@akasha/protocol'
import { Button } from '@akasha/ui/button'
import { ScrollArea } from '@akasha/ui/scroll-area'
import { useQueryClient } from '@tanstack/react-query'
import { type Ref, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  artifactSourceOptions,
  type CanvasBoard,
  type CanvasLocation,
  type CanvasPage,
  createCanvasDocument,
  createCanvasDocumentFromIndex,
  fetchArtifactBoard,
  hasVersionSource,
  type LoadedCanvasBoard,
  useArtifactSourceQuery,
} from '@/entities/artifact'
import { readAnnotationDraft } from '@/entities/feedback'
import { selectionForVersion, syncProjectSelection, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { SplitCodeEditor } from '@/features/code-editor'
import type { CanvasExportSelection } from '@/features/export-design'
import {
  AnchoredAnnotationComposer,
  type AnchoredAnnotationTarget,
  ArtifactReviewPanel,
  selectActiveRound,
} from '@/features/review'
import { VersionDiffView } from '@/features/version-diff'
import { useVisualEdit, VisualEditPanel } from '@/features/visual-edit'
import { getRequestErrorMessage } from '@/shared/api/error'
import { AkashaMark } from '@/shared/brand'
import { isCloudHub } from '@/shared/config/runtime'
import { type Messages, useMessages } from '@/shared/i18n'
import { useBoardCapabilities } from './hooks/useBoardCapabilities'
import { useBoardInspection } from './hooks/useBoardInspection'
import { useCanvasBoardEditing } from './hooks/useCanvasBoardEditing'
import { useInlineCanvasText } from './hooks/useInlineCanvasText'
import { useSelectedVisualTarget } from './hooks/useSelectedVisualTarget'
import { BoardInspector, type BoardInspectorHandoff } from './inspector/BoardInspector'
import type { Point } from './lib/canvas-camera'
import { BoardResources } from './model/board-resources'
import { createBoardTweakPreviewStore } from './model/board-tweak-previews'
import { CanvasBoardEditNotice } from './toolbar/CanvasBoardActions'
import { SelectionToolbar } from './toolbar/SelectionToolbar'
import { ArtifactCanvas, type InspectorReveal } from './ui/ArtifactCanvas'
import { ArtifactFrame, type BoardFramePurpose, type FrameConnection } from './ui/ArtifactFrame'
import { BoardOverflowLayers } from './ui/BoardOverflowLayers'
import { BoardResourceView, readLoadedBoard, useBoardResource } from './ui/BoardResourceView'

const EMPTY_FEEDBACKS: readonly Feedback[] = []

const sourceMessages = {
  '正在读取源码…': ['Quellcode wird geladen…', 'جارٍ تحميل الشفرة المصدرية…', 'Loading source…'],
  '源码读取失败：{error}': [
    'Quellcode konnte nicht geladen werden: {error}',
    'تعذّر تحميل الشفرة المصدرية: {error}',
    'Could not load source: {error}',
  ],
  重试: ['Erneut versuchen', 'إعادة المحاولة', 'Retry'],
} as const satisfies Messages

/** 画布工作区的输入。 */
export interface ArtifactWorkspaceProps {
  detail: ArtifactWorkspaceDetail
  versions: readonly VersionSummary[]
  feedbacks?: readonly Feedback[]
  threads?: Readonly<Record<string, AnnotationThread>>
  rounds?: readonly ReviewRound[]
  sandboxOrigin: string
  /** 链接里的定位；画布据此只定位一次。 */
  address?: string
  /** 固定查看的版本；省略时跟随头版本。 */
  fixedVersion?: number
  onClearAddress?: () => void
  /** 将当前讨论定位写入路由，刷新后仍回到相同线程。 */
  onRememberThread?: (id: string) => void
  /** 从批注线程打开原快照或 Agent 发布的版本并携带定位片段。 */
  onOpenVersion?: (version: number, hash?: string) => void
  /** 只导出当前已保存快照中的画板，编辑器临时预览不提供出口。 */
  onExportBoard?: (boardId: string) => void
  /** 仅在已保存的画布可见时，供导出入口按需读取当前选区。 */
  exportSelectionRef?: Ref<() => CanvasExportSelection | undefined>
  /** 未保存的预览不能移交画板或对象。 */
  onHandoff?: BoardInspectorHandoff
  /** 从已保存且带版本的对象定位进入同一个发布会话。 */
  onAskAgent?: BoardInspectorHandoff
  /** 参数请求受理后查看原绑定会话；分享访客和 Hub 不提供本机入口。 */
  onOpenAgentConversation?: () => void
  /** 登记把状态补丁转发给各画板沙盒的函数；传 `null` 表示注销。 */
  onRegisterStateForwarder?: (forwarder: ((seq: number, ops: JsonPatchOp[]) => void) | null) => void
  onVersionSaved?: (version: Version) => void
  onVersionAdopted?: (version: Version) => void
}

/**
 * Artifact 的主画布工作区。
 *
 * @remarks 沙盒经独立 origin 与 `sandbox="allow-scripts"` 隔离，严禁 `allow-same-origin`。
 * 外壳叠层负责选中框与图钉的绘制；支持 L1 批注评审、L2 属性面板与 L3 分栏代码编辑。
 */
export function ArtifactWorkspace({
  detail,
  versions,
  feedbacks = EMPTY_FEEDBACKS,
  threads,
  rounds: roundsOverride,
  sandboxOrigin,
  address = '',
  fixedVersion,
  onClearAddress,
  onRememberThread,
  onOpenVersion,
  onExportBoard,
  exportSelectionRef,
  onHandoff,
  onAskAgent,
  onOpenAgentConversation,
  onRegisterStateForwarder,
  onVersionSaved,
  onVersionAdopted,
}: ArtifactWorkspaceProps) {
  const { access, artifact, version, state } = detail
  const queryClient = useQueryClient()
  const shareCanEdit = !access || (access.role === 'edit' && fixedVersion === undefined)
  const canWriteVersion =
    shareCanEdit && fixedVersion === undefined && version.version === artifact.headVersion
  const canComment = access?.role !== 'view'
  const rounds = roundsOverride ?? detail.rounds
  const [liveEdit, setLiveEdit] = useState<{ version: number; source: string } | null>(null)
  const [canvasLocation, setCanvasLocation] = useState<CanvasLocation | null>(null)
  const [inspectorReveal, setInspectorReveal] = useState<InspectorReveal | null>(null)
  const [inspectorPage, setInspectorPage] = useState('properties')
  const [inspectorAdvancedOpen, setInspectorAdvancedOpen] = useState(false)
  const [layerFocusToken, setLayerFocusToken] = useState(0)
  const [anchoredComment, setAnchoredComment] = useState<{
    placementId: string
    artifactId: string
    version: number
    boardId?: string
    boardPoint?: Point
    target: AnchoredAnnotationTarget
  } | null>(null)
  const [liveCommentAnchor, setLiveCommentAnchor] = useState<Point | null>(null)
  const clearInspectorReveal = useCallback(() => setInspectorReveal(null), [])
  const latestVersion = useMemo(() => {
    if (versions.length === 0) return version
    return versions.reduce(
      (acc, cur) => (cur.version > acc.version ? cur : acc),
      versions[0] ?? version,
    )
  }, [versions, version])
  const requestedTool = useWorkspaceStore((s) => s.viewMode)
  const viewMode = !shareCanEdit && requestedTool === 'edit' ? 'preview' : requestedTool
  const showCanvas = viewMode === 'preview' || viewMode === 'edit'
  // 首次进入编辑态后保持编辑器挂载（切换回预览/Diff/源码时仅隐藏），防止丢失未保存草稿与撤销栈
  const [editorMounted, setEditorMounted] = useState(viewMode === 'edit')
  const inline = detail.canvas === undefined ? detail.version : undefined
  const sourceRead = useArtifactSourceQuery(
    artifact.publicId,
    version.version,
    !inline && (viewMode === 'edit' || viewMode === 'source'),
  )
  const fullVersion = inline ?? sourceRead.data
  const headSource = useArtifactSourceQuery(
    artifact.publicId,
    latestVersion.version,
    viewMode === 'edit' &&
      latestVersion.version > version.version &&
      !hasVersionSource(latestVersion),
  )
  const editorVersion = useRef<Version | undefined>(undefined)
  if (fullVersion) editorVersion.current = fullVersion
  const previewVersion = fullVersion?.version
  const updateLivePreview = useCallback(
    (source: string | null) => {
      setLiveEdit(
        source !== null && previewVersion !== undefined
          ? { source, version: previewVersion }
          : null,
      )
    },
    [previewVersion],
  )
  useEffect(() => {
    if (viewMode === 'edit') {
      setEditorMounted(true)
    }
  }, [viewMode])
  const setInspectorTab = useWorkspaceStore((s) => s.setInspectorTab)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorTab !== null)
  const tweakScope = JSON.stringify([artifact.publicId, version.version, fixedVersion])
  const tweakPreviews = useMemo(() => {
    void tweakScope
    return createBoardTweakPreviewStore()
  }, [tweakScope])

  const selectedElement = useSelectionStore((s) =>
    selectionForVersion(s, artifact.publicId, version.version),
  )
  const setSelectedElement = useSelectionStore((s) => s.setSelectedElement)

  const activeRound = useMemo(() => selectActiveRound(rounds), [rounds])
  const frames = useRef(new Map<string, FrameConnection>())
  const focusedFrame = useRef<{ id: string; frame: FrameConnection } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 同版本的分享授权变更必须清空该范围的缓存。
  const resources = useMemo(
    () =>
      new BoardResources((id, signal) =>
        fetchArtifactBoard(artifact.publicId, version.version, id, signal),
      ),
    [artifact.publicId, version.version, access?.role, access?.expiresAt],
  )
  useEffect(() => () => resources.reset(), [resources])
  const registerFrame = useCallback((id: string, frame: FrameConnection | null) => {
    if (frame) frames.current.set(id, frame)
    else frames.current.delete(id)
  }, [])
  const registerFocusedFrame = useCallback((id: string, frame: FrameConnection | null) => {
    if (frame) focusedFrame.current = { id, frame }
    else if (focusedFrame.current?.id === id) focusedFrame.current = null
  }, [])
  useEffect(() => {
    onRegisterStateForwarder?.((seq, ops) => {
      for (const frame of frames.current.values()) frame.forwardState(seq, ops)
      focusedFrame.current?.frame.forwardState(seq, ops)
    })
    return () => onRegisterStateForwarder?.(null)
  }, [onRegisterStateForwarder])

  const visual = useVisualEdit({
    artifact,
    version,
    enabled:
      !access &&
      canWriteVersion &&
      viewMode === 'preview' &&
      latestVersion.version === version.version,
    send: (message) => frames.current.get(STANDALONE_BOARD_ID)?.send(message),
    onAnnotate: (element) => {
      setSelectedElement(artifact.publicId, element)
      frames.current.get(STANDALONE_BOARD_ID)?.send({ type: 'highlight', element })
      setInspectorTab('review')
    },
    onVersionSaved,
  })
  const handleVisualMessageRef = useRef(visual.onMessage)
  handleVisualMessageRef.current = visual.onMessage
  const onVisualSelect = useCallback(
    (message: Extract<SandboxToShellMessage, { type: 'visual.select' }>) => {
      handleVisualMessageRef.current(message)
    },
    [],
  )
  const cancelVisual = visual.cancel
  useEffect(() => {
    if (inspectorOpen) cancelVisual()
  }, [inspectorOpen, cancelVisual])

  const lastSyncedSelectionRef = useRef<string | null>(null)
  // 终端只同步当前头版本的选区；读历史不改终端上下文。
  useEffect(() => {
    if (access || fixedVersion !== undefined) return
    const sig = JSON.stringify({
      projectId: artifact.projectId,
      artifactId: artifact.publicId,
      element: selectedElement,
    })
    if (sig === lastSyncedSelectionRef.current) return
    const timer = setTimeout(() => {
      lastSyncedSelectionRef.current = sig
      void syncProjectSelection(artifact.projectId, {
        artifactId: artifact.publicId,
        element: selectedElement,
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [access, artifact.projectId, artifact.publicId, fixedVersion, selectedElement])

  const savedIndex = detail.canvas
  const definition = detail.canvas === undefined ? detail.version.source : detail.canvas
  const editedSource =
    viewMode === 'edit' && fullVersion && liveEdit?.version === version.version
      ? liveEdit.source
      : null
  const readEditorPending = viewMode === 'edit' && !fullVersion
  const canvasProps = fixedVersion === undefined ? state.snapshot.props : undefined
  const savedCanvas = useMemo(
    () =>
      typeof definition === 'string'
        ? createCanvasDocument(
            artifact.type,
            version.title,
            definition,
            version.version,
            canvasProps,
          )
        : createCanvasDocumentFromIndex(definition, canvasProps),
    [artifact.type, version.title, version.version, canvasProps, definition],
  )
  const canvas = useMemo(
    () =>
      editedSource === null || editedSource === fullVersion?.source
        ? savedCanvas
        : createCanvasDocument(
            artifact.type,
            version.title,
            editedSource,
            version.version,
            canvasProps,
          ),
    [
      artifact.type,
      version.title,
      editedSource,
      fullVersion?.source,
      version.version,
      canvasProps,
      savedCanvas,
    ],
  )
  const readBoards = Boolean(savedIndex) && canvas === savedCanvas
  const onDemandChange = useCallback(
    (ids: readonly string[], idle: boolean) => {
      resources.setDemand(readBoards ? ids : [], idle && readBoards)
    },
    [readBoards, resources],
  )
  const inspectedBoardLayout = savedCanvas.pages
    .find((page) => page.id === canvasLocation?.pageId)
    ?.boards.find((board) => board.id === canvasLocation?.boardId)
  const inspected = useBoardResource(inspectedBoardLayout, resources)
  const onRequestBoard = useCallback((id?: string) => resources.setInspectorBoard(id), [resources])
  const onRetryBoard = useCallback((id: string) => resources.retry(id), [resources])
  const canEditBoards =
    canWriteVersion &&
    artifact.type === 'artboard' &&
    (!isCloudHub() || detail.hubCanEditCanvas === true) &&
    viewMode === 'preview' &&
    savedCanvas.pages.every((page) => page.boards.every((board) => board.scoped))
  const canEditText =
    canWriteVersion &&
    viewMode === 'preview' &&
    (canEditBoards || artifact.type === 'html' || artifact.type === 'react')
  const boardEditing = useCanvasBoardEditing({
    artifact,
    version,
    enabled: canEditText,
    notifyAgent: !access,
    onVersionSaved,
  })
  const versionPins = useMemo(() => {
    if (canvas !== savedCanvas) return EMPTY_FEEDBACKS
    const pins: Feedback[] = []
    for (const feedback of feedbacks) {
      if (
        feedback.version !== version.version ||
        !feedback.element ||
        (savedIndex && !feedback.element.boardId) ||
        !isAnnotationKind(feedback.kind)
      )
        continue
      pins.push(feedback)
    }
    return pins
  }, [canvas, savedCanvas, feedbacks, savedIndex, version.version])
  const pageFeedbackIds = useMemo(() => {
    const page = savedCanvas.pages.find((entry) => entry.id === canvasLocation?.pageId)
    const ids = new Set<string>()
    if (!page) return ids
    const boards = new Set(page.boards.map((board) => board.id))
    for (const pin of versionPins) {
      if (boards.has(pin.element?.boardId ?? STANDALONE_BOARD_ID)) ids.add(pin.id)
    }
    return ids
  }, [canvasLocation?.pageId, savedCanvas.pages, versionPins])
  const pageLink = useCallback(
    (id: string) => {
      const path = `/a/${encodeURIComponent(artifact.publicId)}${fixedVersion === undefined ? '' : `/v/${fixedVersion}`}`
      const url = new URL(path, window.location.origin)
      url.hash = new URLSearchParams({ page: id }).toString()
      return url.href
    },
    [artifact.publicId, fixedVersion],
  )
  const canvasSessionKey = `akasha:canvas:${artifact.publicId}/${fixedVersion ?? 'head'}`
  const { canPlay, canAnimate, onObserve } = useBoardCapabilities(
    artifact.publicId,
    version.version,
    editedSource,
  )
  const revealBoard = useCallback((location: InspectorReveal) => {
    useWorkspaceStore.getState().setViewMode('preview')
    setInspectorReveal(location)
  }, [])
  const handleHighlightElement = useCallback(
    (element: ElementRef) => {
      setSelectedElement(artifact.publicId, element)
      const frameId = element.boardId ?? STANDALONE_BOARD_ID
      frames.current.get(frameId)?.send({ type: 'highlight', element })
    },
    [artifact.publicId, setSelectedElement],
  )
  const restoredThread = useRef<string | null>(null)
  const focusThread = useCallback(
    (feedback: Feedback, reveal: boolean, locateAcrossVersions = false) => {
      if (feedback.artifactId !== artifact.publicId) return
      useSelectionStore.getState().setFocusedFeedbackId(feedback.id)
      setInspectorTab('review')
      if (!reveal || !feedback.element) return
      if (!locateAcrossVersions && feedback.version !== version.version) return
      if (savedIndex && !feedback.element.boardId) return
      const boardId = feedback.element.boardId ?? STANDALONE_BOARD_ID
      const active = savedCanvas.pages.find((page) => page.id === canvasLocation?.pageId)
      const includesBoard = (page: CanvasPage) => page.boards.some((board) => board.id === boardId)
      const page = active && includesBoard(active) ? active : savedCanvas.pages.find(includesBoard)
      if (page) revealBoard({ pageId: page.id, boardId })
      handleHighlightElement(feedback.element)
    },
    [
      artifact.publicId,
      canvasLocation?.pageId,
      handleHighlightElement,
      revealBoard,
      savedCanvas.pages,
      setInspectorTab,
      savedIndex,
      version.version,
    ],
  )

  const focusAndRemember = useCallback(
    (feedback: Feedback, reveal: boolean) => {
      restoredThread.current = `${version.version}:${feedback.id}:${reveal ? '1' : '0'}`
      focusThread(feedback, reveal)
      onRememberThread?.(feedback.id)
    },
    [focusThread, onRememberThread, version.version],
  )

  const threadHash = useMemo(() => {
    const params = new URLSearchParams(address.replace(/^#/, ''))
    return {
      thread: params.get('thread'),
      locate: params.get('locate') === '1',
    }
  }, [address])
  useEffect(() => {
    if (!threadHash.thread) {
      restoredThread.current = null
      return
    }
    const key = `${version.version}:${threadHash.thread}:${threadHash.locate ? '1' : '0'}`
    if (restoredThread.current === key) return
    const feedback = feedbacks.find(
      (entry) => entry.id === threadHash.thread && isAnnotationKind(entry.kind),
    )
    if (feedback) {
      restoredThread.current = key
      focusThread(feedback, true, threadHash.locate)
    }
  }, [feedbacks, focusThread, threadHash.locate, threadHash.thread, version.version])
  const sendBoard = useCallback(
    (boardId: string, message: Parameters<FrameConnection['send']>[0]) =>
      frames.current.get(boardId)?.send(message),
    [],
  )
  const followsEditableHead = fixedVersion === undefined && (!access || access.role === 'edit')
  const activeBoard = inspected.loadedBoard ?? inspectedBoardLayout
  const onEnteredLayer = useCallback(() => {
    setLayerFocusToken((count) => count + 1)
  }, [])
  const inspection = useBoardInspection({
    artifactId: artifact.publicId,
    version: version.version,
    followHead: followsEditableHead,
    board: activeBoard,
    current: canvasLocation,
    reveal: revealBoard,
    send: sendBoard,
    onEnteredLayer,
  })
  const selectedLayer = useMemo(
    () => inspection.layers?.layers.find((entry) => entry.id === inspection.selectedId),
    [inspection.layers, inspection.selectedId],
  )
  const selectedBlock = useSelectionStore((state) => {
    const scope = state.layersByArtifact[artifact.publicId]
    const target = state.selectedByArtifact[artifact.publicId]
    if (!target || (target.boardId ?? STANDALONE_BOARD_ID) !== activeBoard?.id) return undefined
    if (selectionForVersion(state, artifact.publicId, version.version)) return target.blockId
    if (
      followsEditableHead &&
      scope &&
      scope.version < version.version &&
      target.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)
    )
      return target.blockId
    return undefined
  })
  const selectedDesignLayer = useMemo(() => {
    if (!activeBoard?.designLayers?.length) return undefined
    if (selectedLayer?.designId) {
      return activeBoard.designLayers.find((item) => item.id === selectedLayer.designId)
    }
    if (selectedBlock?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) {
      const id = selectedBlock.slice(DESIGN_LAYER_BLOCK_PREFIX.length)
      return activeBoard.designLayers.find((item) => item.id === id)
    }
    return undefined
  }, [activeBoard, selectedBlock, selectedLayer])
  const activeSourceLoc =
    !selectedDesignLayer && !activeBoard?.generated
      ? (selectedLayer?.sourceLoc ?? inspection.selectedLoc)
      : undefined
  const runtimeVisualTarget = useSelectedVisualTarget({
    artifact,
    version,
    boardId: activeBoard?.id,
    scoped: Boolean(activeBoard?.scoped),
    loc: activeSourceLoc,
    enabled: Boolean(canEditText && canvas === savedCanvas && activeBoard),
    editing: boardEditing,
  })
  const readFullSource = useCallback(async () => {
    if (fullVersion?.source !== undefined) return fullVersion.source
    try {
      const loaded = await queryClient.fetchQuery(
        artifactSourceOptions(artifact.publicId, version.version),
      )
      return loaded.source
    } catch {
      return null
    }
  }, [artifact.publicId, fullVersion?.source, queryClient, version.version])
  const selectCreatedLayer = useCallback(
    (boardId: string, layer: DesignLayer, savedVersion: number) => {
      const element: ElementRef = {
        boardId,
        blockId: `${DESIGN_LAYER_BLOCK_PREFIX}${layer.id}`,
        rect: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
        ...(layer.kind === 'text' || layer.kind === 'note'
          ? { textPreview: layer.text.slice(0, 160) }
          : {}),
      }
      useSelectionStore.getState().setSelectedElement(artifact.publicId, element, {
        id: `pending:${layer.id}`,
        version: savedVersion,
      })
    },
    [artifact.publicId],
  )
  const inlineText = useInlineCanvasText({
    artifact,
    version,
    enabled: canEditText,
    writable: canWriteVersion,
    shareExpiresAt: access?.expiresAt,
    activeBoardId: canvasLocation?.boardId,
    editing: boardEditing,
    readBoard: (board) => readLoadedBoard(board, resources),
    send: (id, message) => {
      const focused = focusedFrame.current
      if (focused?.id === id) focused.frame.send(message)
      else sendBoard(id, message)
    },
    annotate: (element) => {
      handleHighlightElement(element)
      setInspectorTab('review')
    },
    onLayerCreated: selectCreatedLayer,
  })
  const onTextTarget = inlineText.onTextTarget
  const { onHoverTarget, onPointTarget } = inspection
  const onElementTarget = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => {
      if (message.purpose === 'text') void onTextTarget(boardId, message)
      else if (message.purpose === 'hover') onHoverTarget(boardId, message)
      else onPointTarget(boardId, message)
    },
    [onHoverTarget, onPointTarget, onTextTarget],
  )
  const inspectedBoard = canvasLocation?.boardId ?? inspection.pendingBoardId
  const watchBoard = canvas === savedCanvas ? inspectedBoard : undefined
  const styleLayerId =
    inspection.open &&
    (inspectorPage === 'source' || (inspectorPage === 'properties' && inspectorAdvancedOpen))
      ? inspection.selectedId
      : undefined
  const useTweakPreview = canvas === savedCanvas
  const renderBoard = useCallback(
    (
      board: CanvasBoard,
      purpose: BoardFramePurpose,
      detailed: boolean,
      overlay?: { scale: number; hideSelectionBox: boolean },
    ) => {
      const overview = purpose.type === 'overview'
      const register = purpose.type === 'focus' ? registerFocusedFrame : undefined
      const isInspectedBoard = overview && watchBoard === board.id
      const watchLayers =
        isInspectedBoard || (overview && inspection.open && canvas === savedCanvas && detailed)
      const frame = (board: LoadedCanvasBoard, ready?: () => void) => (
        <ArtifactFrame
          artifact={artifact}
          board={board}
          version={version}
          state={state}
          tweakPreviews={tweakPreviews}
          useTweakPreview={useTweakPreview}
          sandboxOrigin={sandboxOrigin}
          notifyAgent={!access}
          pins={overview ? versionPins : EMPTY_FEEDBACKS}
          onFocusPin={(feedback) => focusAndRemember(feedback, false)}
          hideSelectionBox={overview ? overlay?.hideSelectionBox : undefined}
          pinScale={overview ? overlay?.scale : undefined}
          purpose={purpose}
          register={overview ? registerFrame : register}
          onReady={
            overview && readBoards
              ? (id, capture) => {
                  ready?.()
                  if (capture) resources.previewReady(id, capture)
                }
              : undefined
          }
          onCapabilities={onObserve}
          watchLayers={watchLayers}
          styleLayerId={isInspectedBoard ? styleLayerId : undefined}
          onLayers={inspection.onLayers}
          onElementTarget={onElementTarget}
          onSelectSync={inspection.onSelectSync}
          onVisualSelect={onVisualSelect}
        />
      )
      if (board.source !== undefined) return detailed ? frame(board as LoadedCanvasBoard) : null
      return (
        <BoardResourceView
          key={`${version.version}:${board.id}`}
          board={board}
          resources={resources}
          detailed={detailed}
          showThumbnail={overview}
          render={frame}
        />
      )
    },
    [
      artifact,
      access,
      version,
      state,
      tweakPreviews,
      useTweakPreview,
      sandboxOrigin,
      versionPins,
      focusAndRemember,
      registerFrame,
      registerFocusedFrame,
      onObserve,
      watchBoard,
      inspection.open,
      canvas,
      savedCanvas,
      styleLayerId,
      inspection.onLayers,
      inspection.onSelectSync,
      onElementTarget,
      onVisualSelect,
      readBoards,
      resources,
    ],
  )

  const selectOverflowLayer = useCallback(
    (boardId: string, layerId: string) => {
      const page = savedCanvas.pages.find((entry) => entry.boards.some((b) => b.id === boardId))
      if (page) revealBoard({ pageId: page.id, boardId })
      handleHighlightElement({
        boardId,
        blockId: `${DESIGN_LAYER_BLOCK_PREFIX}${layerId}`,
      })
    },
    [handleHighlightElement, revealBoard, savedCanvas.pages],
  )
  const renderBoardOverflow = useCallback(
    (board: CanvasBoard, scale: number, interactive: boolean) =>
      board.scoped ? (
        <BoardOverflowEntry
          board={board}
          resources={resources}
          scale={scale}
          interactive={interactive}
          onSelectLayer={selectOverflowLayer}
        />
      ) : null,
    [resources, selectOverflowLayer],
  )

  const openCodeEditor = () => {
    setInspectorTab(null)
    useWorkspaceStore.getState().setViewMode('edit')
  }

  // 热更新推进版本时不卸载未发送的选区批注浮层，沿用其发起时的原版本与目标草稿。
  const activeAnchoredComment =
    canComment && anchoredComment?.artifactId === artifact.publicId ? anchoredComment : null

  const draftingRound = !access && activeRound?.status === 'drafting' ? activeRound : null
  const resolveAnchoredElement = (): { element: ElementRef; label?: string } | null => {
    if (selectedElement) {
      const label =
        selectedLayer?.label ??
        (selectedDesignLayer &&
        (selectedDesignLayer.kind === 'text' || selectedDesignLayer.kind === 'note')
          ? selectedDesignLayer.text.slice(0, 40)
          : undefined) ??
        selectedElement.textPreview
      return { element: selectedElement, label }
    }
    if (selectedDesignLayer && activeBoard) {
      const textLabel =
        selectedDesignLayer.kind === 'text' || selectedDesignLayer.kind === 'note'
          ? selectedDesignLayer.text.slice(0, 40)
          : undefined
      return {
        element: {
          ...(activeBoard.scoped ? { boardId: activeBoard.id } : {}),
          blockId: `${DESIGN_LAYER_BLOCK_PREFIX}${selectedDesignLayer.id}`,
          ...(textLabel ? { textPreview: textLabel } : {}),
        },
        label: textLabel ?? activeBoard.title,
      }
    }
    if (selectedLayer && activeBoard) {
      return {
        element: {
          ...(activeBoard.scoped ? { boardId: activeBoard.id } : {}),
          selector: selectedLayer.selector,
          ...(!activeBoard.scoped && selectedLayer.sourceLoc
            ? { loc: selectedLayer.sourceLoc }
            : {}),
          ...(selectedLayer.label ? { textPreview: selectedLayer.label } : {}),
        },
        label: selectedLayer.label || activeBoard.title,
      }
    }
    if (inspectedBoardLayout?.scoped) {
      return {
        element: { boardId: inspectedBoardLayout.id, blockId: inspectedBoardLayout.id },
        label: inspectedBoardLayout.title,
      }
    }
    return null
  }
  const openAnchoredComment = (anchor?: Point) => {
    if (!canComment) {
      setInspectorTab('review')
      return
    }
    const resolved = resolveAnchoredElement()
    if (!resolved || !anchor) {
      if (resolved) handleHighlightElement(resolved.element)
      setInspectorTab('review')
      return
    }
    handleHighlightElement(resolved.element)
    useWorkspaceStore.getState().setShowComments(true)
    const placementId = crypto.randomUUID()
    let boardPoint: Point | undefined
    if (selectedDesignLayer) {
      boardPoint = {
        x: selectedDesignLayer.x + selectedDesignLayer.width,
        y: selectedDesignLayer.y,
      }
    } else if (resolved.element.rect && resolved.element.rect.width > 0) {
      boardPoint = {
        x: resolved.element.rect.x + resolved.element.rect.width,
        y: resolved.element.rect.y,
      }
    } else if (inspectedBoardLayout) {
      boardPoint = { x: 24, y: 24 }
    }
    setLiveCommentAnchor(null)
    setAnchoredComment({
      placementId,
      artifactId: artifact.publicId,
      version: version.version,
      boardId: resolved.element.boardId ?? activeBoard?.id,
      boardPoint,
      target: {
        placementId,
        anchor,
        element: resolved.element,
        label: resolved.label,
      },
    })
  }
  const openCommentAtPoint = useCallback(
    (board: CanvasBoard, point: Point, anchor: Point) => {
      if (!canComment) return
      useWorkspaceStore.getState().setShowComments(true)
      const placementId = crypto.randomUUID()
      const pointRect = { x: Math.round(point.x), y: Math.round(point.y), width: 1, height: 1 }
      const hoveredHit =
        inspection.hovered?.boardId === board.id &&
        inspection.hovered.element.rect &&
        point.x >= inspection.hovered.element.rect.x - 2 &&
        point.x <= inspection.hovered.element.rect.x + inspection.hovered.element.rect.width + 2 &&
        point.y >= inspection.hovered.element.rect.y - 2 &&
        point.y <= inspection.hovered.element.rect.y + inspection.hovered.element.rect.height + 2
          ? inspection.hovered
          : null
      const fallbackElement: ElementRef =
        hoveredHit?.element ??
        (board.scoped
          ? { boardId: board.id, blockId: board.id, rect: pointRect }
          : { textPreview: board.title, rect: pointRect })
      const initialLabel = hoveredHit?.label ? `${board.title} › ${hoveredHit.label}` : board.title
      setLiveCommentAnchor(null)
      setAnchoredComment({
        placementId,
        artifactId: artifact.publicId,
        version: version.version,
        boardId: board.id,
        boardPoint: point,
        target: {
          placementId,
          anchor,
          element: fallbackElement,
          label: initialLabel,
        },
      })
      if (canvas !== savedCanvas) return
      inspection.pickPoint(board.id, point, {
        requestId: placementId,
        onResolved: (message) => {
          const hit = message.element
          if (!hit) return
          const loaded = readLoadedBoard(board, resources) ?? board
          let hitLabel: string | undefined
          if (hit.blockId?.startsWith(DESIGN_LAYER_BLOCK_PREFIX)) {
            const id = hit.blockId.slice(DESIGN_LAYER_BLOCK_PREFIX.length)
            const designLayer = loaded.designLayers?.find((item) => item.id === id)
            if (designLayer && (designLayer.kind === 'text' || designLayer.kind === 'note')) {
              hitLabel = designLayer.text.trim().slice(0, 40) || undefined
            }
          }
          const selectorTag = hit.selector
            ? /^([a-zA-Z][\w-]*)/.exec(hit.selector.split('>').pop()?.trim() ?? '')?.[1]
            : undefined
          hitLabel ??=
            hit.textPreview?.slice(0, 40) ??
            (hit.blockId ? `#${hit.blockId}` : undefined) ??
            (selectorTag ? `<${selectorTag.toLowerCase()}>` : hit.selector?.slice(0, 28))
          const label = hitLabel ? `${board.title} › ${hitLabel}` : board.title
          setAnchoredComment((current) =>
            current && current.placementId === placementId
              ? {
                  ...current,
                  target: { ...current.target, element: hit, label },
                }
              : current,
          )
        },
      })
    },
    [artifact.publicId, canComment, canvas, inspection, resources, savedCanvas, version.version],
  )
  const dismissAnchoredComment = useCallback(() => {
    const saved = readAnnotationDraft(artifact.publicId)
    if (!saved?.body) setAnchoredComment(null)
  }, [artifact.publicId])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {editorMounted && shareCanEdit ? (
          <div
            className={viewMode === 'edit' ? 'h-1/2 min-h-0 shrink-0 md:h-auto md:w-1/2' : 'hidden'}
          >
            {editorVersion.current && (
              <div className="size-full" hidden={readEditorPending}>
                <SplitCodeEditor
                  artifact={artifact}
                  version={editorVersion.current}
                  latestVersion={
                    hasVersionSource(latestVersion)
                      ? latestVersion
                      : (headSource.data ?? fullVersion)
                  }
                  notifyAgent={!access}
                  onLivePreviewChange={updateLivePreview}
                  onVersionSaved={onVersionSaved}
                  onVersionAdopted={onVersionAdopted}
                />
              </div>
            )}
            {readEditorPending && (
              <SourceStatus error={sourceRead.error} retry={() => void sourceRead.refetch()} />
            )}
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 隐藏工具不重置相机；多板预览只在当前可见或被打开时运行。 */}
          <ArtifactCanvas
            key={canvasSessionKey}
            document={canvas}
            collaborationEnabled={
              isCloudHub() &&
              detail.hubCanEditCanvas === true &&
              canWriteVersion &&
              showCanvas &&
              canvas === savedCanvas
            }
            storageKey={canvasSessionKey}
            address={address}
            onClearAddress={onClearAddress}
            onExportBoard={canvas === savedCanvas ? onExportBoard : undefined}
            exportVersion={version}
            exportSelectionRef={
              showCanvas && canvas === savedCanvas ? exportSelectionRef : undefined
            }
            pageLink={pageLink}
            reveal={inspectorReveal}
            onRevealHandled={clearInspectorReveal}
            onLocationChange={setCanvasLocation}
            onSelectPoint={canvas === savedCanvas ? inspection.pickPoint : undefined}
            onHoverPoint={canvas === savedCanvas ? inspection.hoverPoint : undefined}
            onHoverClear={inspection.clearHover}
            hoveredElement={canvas === savedCanvas ? inspection.hovered : null}
            onClearElement={inspection.clearPoint}
            canComment={canComment}
            onCommentPoint={openCommentAtPoint}
            onDismissComment={dismissAnchoredComment}
            pendingCommentPin={
              activeAnchoredComment?.boardId && activeAnchoredComment.boardPoint
                ? {
                    boardId: activeAnchoredComment.boardId,
                    point: activeAnchoredComment.boardPoint,
                  }
                : null
            }
            onPendingCommentAnchorChange={setLiveCommentAnchor}
            onLayerCreated={selectCreatedLayer}
            boardEditing={canEditBoards ? boardEditing : undefined}
            historyEditing={canEditText ? boardEditing : undefined}
            editNotice={
              boardEditing.draft || (canEditText && boardEditing.inputError) ? (
                <CanvasBoardEditNotice editing={boardEditing} />
              ) : null
            }
            textTools={canEditText ? inlineText.tools : undefined}
            inlineText={
              inlineText.draft
                ? {
                    draft: inlineText.draft,
                    initialText: inlineText.initialText,
                    onInput: inlineText.remember,
                    onClose: inlineText.close,
                    onSave: inlineText.save,
                    onAnnotate: inlineText.annotate,
                  }
                : null
            }
            pageEditing={
              canEditBoards && !boardEditing.draft && !boardEditing.busy
                ? { artifact, version, onVersionSaved }
                : undefined
            }
            renderBoard={renderBoard}
            renderBoardOverflow={renderBoardOverflow}
            renderSelectionToolbar={
              canvas === savedCanvas && activeBoard
                ? (anchor) => (
                    <SelectionToolbar
                      anchor={anchor}
                      board={activeBoard}
                      runtimeLayer={selectedLayer}
                      designLayer={selectedDesignLayer}
                      sourceLoc={activeSourceLoc}
                      selectedRect={selectedElement?.rect}
                      presentation={inspection.presentation}
                      visualTarget={runtimeVisualTarget.target}
                      propertiesOpen={inspection.open && inspectorPage === 'properties'}
                      drawerOpen={inspectorOpen}
                      canEditBoards={canEditBoards}
                      canEditText={canEditText}
                      canComment={canComment}
                      editing={canEditText ? boardEditing : undefined}
                      textTools={canEditText ? inlineText.tools : undefined}
                      onApplyRuntimeOp={runtimeVisualTarget.applyOp}
                      onComment={(point) => openAnchoredComment(point)}
                    />
                  )
                : undefined
            }
            layerSelection={
              canvas === savedCanvas
                ? {
                    board: activeBoard,
                    layers: inspection.layers?.layers ?? [],
                    selectedLayer,
                    selectedDesignLayer,
                    sourceLoc: activeSourceLoc,
                    selectedElement,
                    presentation: inspection.presentation,
                    visualTarget: runtimeVisualTarget.target,
                    onSelectLayer: inspection.onSelect,
                    onEnterBoard: inspection.enterBoard,
                    onApplyRuntimeOp: runtimeVisualTarget.applyOp,
                    onHtmlElementSaved: inspection.preserveSourceSelection,
                    readFullSource,
                    focusToken: layerFocusToken,
                  }
                : undefined
            }
            onDemandChange={onDemandChange}
            canPlay={canPlay}
            canAnimate={canAnimate}
            visible={showCanvas}
            visualEdit={
              visual.available
                ? {
                    isPicking: visual.isPicking,
                    cancel: visual.cancel,
                    toggle: () => {
                      setInspectorTab(null)
                      visual.toggle()
                    },
                  }
                : undefined
            }
          />

          {viewMode === 'diff' ? (
            <div className="h-full w-full">
              <VersionDiffView versions={versions} activeVersion={version.version} />
            </div>
          ) : null}

          {viewMode === 'source' ? (
            <ScrollArea
              orientation="both"
              aria-label={artifact.title}
              tabIndex={-1}
              className="h-full w-full bg-surface [--v-scroll-area-padding:16px] [--v-scroll-area-surface:var(--surface)]"
            >
              {fullVersion ? (
                <pre
                  dir="ltr"
                  className="w-max min-w-full rounded-xl border border-border bg-surface-subtle p-4 font-mono text-xs leading-6 text-ink"
                >
                  <code>{fullVersion.source}</code>
                </pre>
              ) : (
                <SourceStatus error={sourceRead.error} retry={() => void sourceRead.refetch()} />
              )}
            </ScrollArea>
          ) : null}
        </div>
      </main>

      <ArtifactReviewPanel
        artifactId={artifact.publicId}
        projectId={artifact.projectId}
        activeVersion={version.version}
        activeRound={activeRound}
        feedbacks={feedbacks}
        canComment={canComment}
        notifyAgent={!access}
        threads={threads}
        pageFeedbackIds={pageFeedbackIds}
        onFocusThread={(feedback) => {
          useWorkspaceStore.getState().setShowComments(true)
          focusAndRemember(feedback, true)
        }}
        onOpenVersion={onOpenVersion}
      />
      <BoardInspector
        artifact={artifact}
        tab={inspectorPage}
        onTabChange={setInspectorPage}
        advancedOpen={inspectorAdvancedOpen}
        onAdvancedOpenChange={setInspectorAdvancedOpen}
        {...inspected}
        onRequestBoard={onRequestBoard}
        onRetryBoard={inspected.canRetryBoard ? onRetryBoard : undefined}
        version={version}
        stateSnapshot={state.snapshot}
        document={savedCanvas}
        location={canvasLocation}
        readOnly={!canWriteVersion}
        templateReadOnly={Boolean(access) || !canWriteVersion}
        tweakPreviews={tweakPreviews}
        onOpenEditor={canWriteVersion ? openCodeEditor : undefined}
        followHead={followsEditableHead}
        canComment={canComment}
        editing={canEditBoards ? boardEditing : undefined}
        elementEditing={canEditText ? boardEditing : undefined}
        onEditText={canEditBoards && boardEditing.available ? inlineText.tools.edit : undefined}
        onEditSourceText={
          canEditText && boardEditing.available ? inlineText.tools.editSource : undefined
        }
        selectedElement={canvas === savedCanvas ? selectedElement : null}
        sourceLoc={canvas === savedCanvas ? activeSourceLoc : undefined}
        presentation={canvas === savedCanvas ? inspection.presentation : null}
        visualTarget={canvas === savedCanvas ? runtimeVisualTarget.target : null}
        onApplyRuntimeOp={canvas === savedCanvas ? runtimeVisualTarget.applyOp : undefined}
        readFullSource={readFullSource}
        onHtmlElementSaved={inspection.preserveSourceSelection}
        layers={watchBoard ? inspection.layers : null}
        selectedLayerId={inspection.selectedId}
        layersAvailable={canvas === savedCanvas}
        onHandoff={canvas === savedCanvas ? onHandoff : undefined}
        onAskAgent={canvas === savedCanvas ? onAskAgent : undefined}
        onOpenAgentConversation={onOpenAgentConversation}
        canPublishTweaks={!access && canEditBoards}
        onSelectLayer={inspection.onSelect}
        onNavigate={(location) => {
          inspection.clearPoint()
          revealBoard({ ...location, fit: true })
        }}
      />
      <VisualEditPanel controller={visual} />
      {activeAnchoredComment ? (
        <AnchoredAnnotationComposer
          artifactId={artifact.publicId}
          projectId={artifact.projectId}
          version={version.version}
          originVersion={activeAnchoredComment.version}
          target={
            liveCommentAnchor
              ? { ...activeAnchoredComment.target, anchor: liveCommentAnchor }
              : activeAnchoredComment.target
          }
          activeDraftingRound={draftingRound}
          notifyAgent={!access}
          onClose={() => {
            setAnchoredComment(null)
            setLiveCommentAnchor(null)
          }}
          onOpenAllDiscussions={() => setInspectorTab('review')}
          onOpenVersion={onOpenVersion}
        />
      ) : null}
    </div>
  )
}

function BoardOverflowEntry({
  board,
  resources,
  scale,
  interactive,
  onSelectLayer,
}: {
  board: CanvasBoard
  resources: BoardResources
  scale: number
  interactive: boolean
  onSelectLayer: (boardId: string, layerId: string) => void
}) {
  const { loadedBoard } = useBoardResource(board, resources)
  const resolved = loadedBoard ?? board
  return (
    <BoardOverflowLayers
      board={resolved}
      layers={resolved.designLayers}
      scale={scale}
      interactive={interactive}
      onSelectLayer={onSelectLayer}
    />
  )
}

function SourceStatus({ error, retry }: { error: Error | null; retry: () => void }) {
  const { t } = useMessages(sourceMessages)
  if (!error)
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-ink-muted" role="status">
        <AkashaMark size={16} loading className="text-ink" />
        <span>{t('正在读取源码…')}</span>
      </p>
    )
  return (
    <div className="space-y-2 p-3 text-sm" role="alert">
      <p>{t('源码读取失败：{error}', { error: getRequestErrorMessage(error) })}</p>
      <Button onClick={retry} size="sm" variant="outline">
        {t('重试')}
      </Button>
    </div>
  )
}
