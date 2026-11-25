import {
  type AnnotationThread,
  type ArtifactWorkspaceDetail,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { selectionForVersion, syncProjectSelection, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { SplitCodeEditor } from '@/features/code-editor'
import { ArtifactReviewPanel, selectActiveRound } from '@/features/review'
import { VersionDiffView } from '@/features/version-diff'
import { useVisualEdit, VisualEditPanel } from '@/features/visual-edit'
import { AkashaMark } from '@/shared/brand'
import { ArtifactCanvas, type InspectorReveal } from './ArtifactCanvas'
import { ArtifactFrame, type BoardFramePurpose, type FrameConnection } from './ArtifactFrame'
import { BoardInspector, type BoardInspectorHandoff } from './BoardInspector'
import { BoardResourceView, readLoadedBoard, useBoardResource } from './BoardResourceView'
import { BoardResources } from './board-resources'
import { createBoardTweakPreviewStore } from './board-tweak-previews'
import { InlineCanvasText } from './InlineCanvasText'
import { useBoardCapabilities } from './useBoardCapabilities'
import { useBoardInspection } from './useBoardInspection'
import { useCanvasBoardEditing } from './useCanvasBoardEditing'
import { useInlineCanvasText } from './useInlineCanvasText'

const EMPTY_FEEDBACKS: readonly Feedback[] = []

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
  /** 只导出当前已保存快照中的画板，编辑器临时预览不提供出口。 */
  onExportBoard?: (boardId: string) => void
  /** 未保存的预览不能移交画板或对象。 */
  onHandoff?: BoardInspectorHandoff
  /** 从已保存且带版本的对象定位进入同一个发布会话。 */
  onAskAgent?: BoardInspectorHandoff
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
  onExportBoard,
  onHandoff,
  onAskAgent,
  onRegisterStateForwarder,
  onVersionSaved,
  onVersionAdopted,
}: ArtifactWorkspaceProps) {
  const { access, artifact, version, state } = detail
  const shareCanEdit = !access || (access.role === 'edit' && fixedVersion === undefined)
  const canWriteVersion =
    shareCanEdit && fixedVersion === undefined && version.version === artifact.headVersion
  const canComment = access?.role !== 'view'
  const rounds = roundsOverride ?? detail.rounds
  const [liveEdit, setLiveEdit] = useState<{ version: number; source: string } | null>(null)
  const [canvasLocation, setCanvasLocation] = useState<CanvasLocation | null>(null)
  const [inspectorReveal, setInspectorReveal] = useState<InspectorReveal | null>(null)
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
  const focusedFrame = useRef<FrameConnection | null>(null)
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
  const registerFocusedFrame = useCallback((_id: string, frame: FrameConnection | null) => {
    focusedFrame.current = frame
  }, [])
  useEffect(() => {
    onRegisterStateForwarder?.((seq, ops) => {
      for (const frame of frames.current.values()) frame.forwardState(seq, ops)
      focusedFrame.current?.forwardState(seq, ops)
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
  const restoredThread = useRef<string | null>(null)
  const focusThread = useCallback(
    (feedback: Feedback, reveal: boolean) => {
      if (feedback.artifactId !== artifact.publicId) return
      useSelectionStore.getState().setFocusedFeedbackId(feedback.id)
      setInspectorTab('review')
      if (!reveal || !feedback.element || feedback.version !== version.version) return
      if (savedIndex && !feedback.element.boardId) return
      const boardId = feedback.element.boardId ?? STANDALONE_BOARD_ID
      const active = savedCanvas.pages.find((page) => page.id === canvasLocation?.pageId)
      const includesBoard = (page: CanvasPage) => page.boards.some((board) => board.id === boardId)
      const page = active && includesBoard(active) ? active : savedCanvas.pages.find(includesBoard)
      if (page) revealBoard({ pageId: page.id, boardId })
    },
    [
      artifact.publicId,
      canvasLocation?.pageId,
      revealBoard,
      savedCanvas.pages,
      setInspectorTab,
      savedIndex,
      version.version,
    ],
  )

  const focusAndRemember = useCallback(
    (feedback: Feedback, reveal: boolean) => {
      restoredThread.current = `${version.version}:${feedback.id}`
      focusThread(feedback, reveal)
      onRememberThread?.(feedback.id)
    },
    [focusThread, onRememberThread, version.version],
  )

  const linkedThread = useMemo(
    () => new URLSearchParams(address.replace(/^#/, '')).get('thread'),
    [address],
  )
  useEffect(() => {
    if (!linkedThread) {
      restoredThread.current = null
      return
    }
    const key = `${version.version}:${linkedThread}`
    if (restoredThread.current === key) return
    const feedback = feedbacks.find(
      (entry) => entry.id === linkedThread && isAnnotationKind(entry.kind),
    )
    if (feedback) {
      restoredThread.current = key
      focusThread(feedback, true)
    }
  }, [feedbacks, focusThread, linkedThread, version.version])
  const handleHighlightElement = useCallback(
    (element: ElementRef) => {
      setSelectedElement(artifact.publicId, element)
      const frameId = element.boardId ?? STANDALONE_BOARD_ID
      frames.current.get(frameId)?.send({ type: 'highlight', element })
    },
    [artifact.publicId, setSelectedElement],
  )
  const sendBoard = useCallback(
    (boardId: string, message: Parameters<FrameConnection['send']>[0]) =>
      frames.current.get(boardId)?.send(message),
    [],
  )
  const followsEditableHead = fixedVersion === undefined && (!access || access.role === 'edit')
  const inspection = useBoardInspection({
    artifactId: artifact.publicId,
    version: version.version,
    followHead: followsEditableHead,
    board: inspected.loadedBoard ?? inspectedBoardLayout,
    current: canvasLocation,
    reveal: revealBoard,
    send: sendBoard,
  })
  const inlineText = useInlineCanvasText({
    artifact,
    version,
    enabled: canEditText,
    activeBoardId: canvasLocation?.boardId,
    editing: boardEditing,
    readBoard: (board) => readLoadedBoard(board, resources),
    send: sendBoard,
    annotate: (element) => {
      handleHighlightElement(element)
      setInspectorTab('review')
    },
  })
  const onTextTarget = inlineText.onTextTarget
  const { onPointTarget } = inspection
  const onElementTarget = useCallback(
    (boardId: string, message: Extract<SandboxToShellMessage, { type: 'inspect.target' }>) => {
      if (message.purpose === 'text') void onTextTarget(boardId, message)
      else onPointTarget(boardId, message)
    },
    [onPointTarget, onTextTarget],
  )
  const inspectedBoard = inspection.open ? canvasLocation?.boardId : inspection.pendingBoardId
  const watchBoard = canvas === savedCanvas ? inspectedBoard : undefined
  const useTweakPreview = canvas === savedCanvas
  const renderBoard = useCallback(
    (board: CanvasBoard, purpose: BoardFramePurpose, detailed: boolean) => {
      const overview = purpose.type === 'overview'
      const register = purpose.type === 'focus' ? registerFocusedFrame : undefined
      const frame = (board: LoadedCanvasBoard, ready?: () => void) => (
        <ArtifactFrame
          artifact={artifact}
          board={board}
          version={version}
          state={state}
          tweakPreviews={tweakPreviews}
          useTweakPreview={useTweakPreview}
          sandboxOrigin={sandboxOrigin}
          pins={overview ? versionPins : EMPTY_FEEDBACKS}
          onFocusPin={(feedback) => focusAndRemember(feedback, false)}
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
          watchLayers={overview && watchBoard === board.id}
          onLayers={inspection.onLayers}
          onElementTarget={onElementTarget}
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
      inspection.onLayers,
      onElementTarget,
      onVisualSelect,
      readBoards,
      resources,
    ],
  )

  const openCodeEditor = () => {
    setInspectorTab(null)
    useWorkspaceStore.getState().setViewMode('edit')
  }

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
            storageKey={canvasSessionKey}
            address={address}
            onClearAddress={onClearAddress}
            onExportBoard={canvas === savedCanvas ? onExportBoard : undefined}
            pageLink={pageLink}
            reveal={inspectorReveal}
            onRevealHandled={clearInspectorReveal}
            onLocationChange={setCanvasLocation}
            onSelectPoint={canvas === savedCanvas ? inspection.pickPoint : undefined}
            onClearElement={inspection.clearPoint}
            onComment={() => {
              if (canComment && !selectedElement && inspectedBoardLayout?.scoped) {
                const boardId = inspectedBoardLayout.id
                handleHighlightElement({ boardId, blockId: boardId })
              }
              setInspectorTab('review')
            }}
            boardEditing={canEditBoards ? boardEditing : undefined}
            historyEditing={canEditText ? boardEditing : undefined}
            textTools={canEditText ? inlineText.tools : undefined}
            pageEditing={
              canEditBoards && !boardEditing.draft && !boardEditing.busy
                ? { artifact, version, onVersionSaved }
                : undefined
            }
            renderBoard={renderBoard}
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
            <div className="h-full w-full overflow-auto bg-surface p-4">
              {fullVersion ? (
                <pre className="rounded-xl border border-border bg-surface-subtle p-4 font-mono text-xs leading-6 text-ink">
                  <code>{fullVersion.source}</code>
                </pre>
              ) : (
                <SourceStatus error={sourceRead.error} retry={() => void sourceRead.refetch()} />
              )}
            </div>
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
        onFocusThread={(feedback) => focusAndRemember(feedback, true)}
      />
      <BoardInspector
        artifact={artifact}
        {...inspected}
        onRequestBoard={onRequestBoard}
        onRetryBoard={onRetryBoard}
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
        onEditText={canEditBoards && boardEditing.available ? inlineText.tools.edit : undefined}
        layers={watchBoard ? inspection.layers : null}
        selectedLayerId={inspection.selectedId}
        layersAvailable={canvas === savedCanvas}
        onHandoff={canvas === savedCanvas ? onHandoff : undefined}
        onAskAgent={canvas === savedCanvas ? onAskAgent : undefined}
        onSelectLayer={inspection.onSelect}
        onNavigate={(location) => {
          inspection.clearPoint()
          revealBoard({ ...location, fit: true })
        }}
      />
      <VisualEditPanel controller={visual} />
      {inlineText.draft ? (
        <InlineCanvasText
          draft={inlineText.draft}
          onClose={inlineText.close}
          onSave={inlineText.save}
          onAnnotate={inlineText.annotate}
        />
      ) : null}
    </div>
  )
}

function SourceStatus({ error, retry }: { error: Error | null; retry: () => void }) {
  if (!error)
    return (
      <p className="flex items-center gap-2 p-3 text-sm text-ink-muted" role="status">
        <AkashaMark size={16} loading className="text-ink" />
        <span>正在读取源码…</span>
      </p>
    )
  return (
    <div className="space-y-2 p-3 text-sm" role="alert">
      <p>源码读取失败：{error.message}</p>
      <Button onClick={retry} size="sm" variant="outline">
        重试
      </Button>
    </div>
  )
}
