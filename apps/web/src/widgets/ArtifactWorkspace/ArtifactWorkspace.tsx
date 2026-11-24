import {
  type AnnotationThread,
  type ElementRef,
  type Feedback,
  isAnnotationKind,
  type JsonPatchOp,
  type ReviewRound,
  type SandboxToShellMessage,
  STANDALONE_BOARD_ID,
} from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type ArtifactDetailResponse,
  type CanvasBoard,
  type CanvasLocation,
  type CanvasPage,
  createCanvasDocument,
} from '@/entities/artifact'
import { selectionForVersion, syncProjectSelection, useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { SplitCodeEditor } from '@/features/code-editor'
import { ArtifactReviewPanel, selectActiveRound } from '@/features/review'
import { VersionDiffView } from '@/features/version-diff'
import { useVisualEdit, VisualEditPanel } from '@/features/visual-edit'
import { ArtifactCanvas, type InspectorReveal } from './ArtifactCanvas'
import { ArtifactFrame, type BoardFramePurpose, type FrameConnection } from './ArtifactFrame'
import { BoardInspector, type BoardInspectorHandoff } from './BoardInspector'
import { createCanvasElementResolver } from './feedback-location'
import { InlineCanvasText } from './InlineCanvasText'
import { useBoardInspection } from './useBoardInspection'
import { useCanvasBoardEditing } from './useCanvasBoardEditing'
import { useInlineCanvasText } from './useInlineCanvasText'

const EMPTY_FEEDBACKS: readonly Feedback[] = []

/** 画布工作区的输入。 */
export interface ArtifactWorkspaceProps {
  detail: ArtifactDetailResponse
  versions: readonly ArtifactDetailResponse['version'][]
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
  onVersionSaved?: (version: ArtifactDetailResponse['version']) => void
  onVersionAdopted?: (version: ArtifactDetailResponse['version']) => void
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
  const canComment = access?.role !== 'view'
  const rounds = roundsOverride ?? detail.rounds
  const [liveEditSource, setLiveEditSource] = useState<string | null>(null)
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
  useEffect(() => {
    if (viewMode === 'edit') {
      setEditorMounted(true)
    }
  }, [viewMode])
  const setInspectorTab = useWorkspaceStore((s) => s.setInspectorTab)
  const inspectorOpen = useWorkspaceStore((s) => s.inspectorTab !== null)

  const selectedElement = useSelectionStore((s) =>
    selectionForVersion(s, artifact.publicId, version.version),
  )
  const setSelectedElement = useSelectionStore((s) => s.setSelectedElement)

  const activeRound = useMemo(() => selectActiveRound(rounds), [rounds])
  const frames = useRef(new Map<string, FrameConnection>())
  const focusedFrame = useRef<FrameConnection | null>(null)
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
  useEffect(
    () => () => {
      const selection = useSelectionStore.getState()
      selection.setPickerActive(false)
      selection.setHoveredElement(null)
    },
    [],
  )

  const visual = useVisualEdit({
    artifact,
    version,
    enabled: !access && viewMode === 'preview' && latestVersion.version === version.version,
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
  // 终端只同步选区。批注正文必须通过明确的投递动作才能抵达 Agent。
  useEffect(() => {
    if (access) return
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
  }, [access, artifact.projectId, artifact.publicId, selectedElement])

  const effectivePreviewSource =
    viewMode === 'edit' && liveEditSource !== null ? liveEditSource : version.source
  const canvasProps = fixedVersion === undefined ? state.snapshot.props : undefined
  const savedCanvas = useMemo(
    () =>
      createCanvasDocument(
        artifact.type,
        version.title,
        version.source,
        version.version,
        canvasProps,
      ),
    [artifact.type, version.title, version.source, version.version, canvasProps],
  )
  const canvas = useMemo(
    () =>
      effectivePreviewSource === version.source
        ? savedCanvas
        : createCanvasDocument(
            artifact.type,
            version.title,
            effectivePreviewSource,
            version.version,
            canvasProps,
          ),
    [
      artifact.type,
      version.title,
      effectivePreviewSource,
      version.source,
      version.version,
      canvasProps,
      savedCanvas,
    ],
  )
  const canEditBoards =
    shareCanEdit &&
    artifact.type === 'artboard' &&
    fixedVersion === undefined &&
    version.version === artifact.headVersion &&
    viewMode === 'preview' &&
    savedCanvas.pages.every((page) => page.boards.every((board) => board.scoped))
  const canEditText =
    shareCanEdit &&
    fixedVersion === undefined &&
    version.version === artifact.headVersion &&
    viewMode === 'preview' &&
    (canEditBoards || artifact.type === 'html' || artifact.type === 'react')
  const boardEditing = useCanvasBoardEditing({
    artifact,
    version,
    enabled: canEditText,
    notifyAgent: !access,
    onVersionSaved,
  })
  const resolveElement = useMemo(
    () => (artifact.type === 'artboard' ? createCanvasElementResolver(savedCanvas) : null),
    [artifact.type, savedCanvas],
  )
  const versionPins = useMemo(() => {
    if (canvas !== savedCanvas) return EMPTY_FEEDBACKS
    const pins: Feedback[] = []
    for (const feedback of feedbacks) {
      if (
        feedback.version !== version.version ||
        !feedback.element ||
        !isAnnotationKind(feedback.kind)
      )
        continue
      const element = resolveElement?.(feedback.element) ?? feedback.element
      pins.push(element === feedback.element ? feedback : { ...feedback, element })
    }
    return pins
  }, [canvas, savedCanvas, feedbacks, resolveElement, version.version])
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
  const [playable, setPlayable] = useState<{
    artifactId: string
    version: number
    sources: ReadonlyMap<string, string>
  } | null>(null)
  const onPlayable = useCallback(
    (board: CanvasBoard, activeVersion: number, available: boolean) => {
      setPlayable((previous) => {
        const sources =
          previous?.artifactId === artifact.publicId && previous.version === activeVersion
            ? previous.sources
            : undefined
        if (available ? sources?.get(board.id) === board.source : !sources?.has(board.id)) {
          return previous
        }
        const next = new Map(sources)
        if (available) next.set(board.id, board.source)
        else next.delete(board.id)
        return { artifactId: artifact.publicId, version: activeVersion, sources: next }
      })
    },
    [artifact.publicId],
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
      const target = resolveElement?.(feedback.element) ?? feedback.element
      const boardId = target.boardId ?? STANDALONE_BOARD_ID
      const active = savedCanvas.pages.find((page) => page.id === canvasLocation?.pageId)
      const includesBoard = (page: CanvasPage) => page.boards.some((board) => board.id === boardId)
      const page = active && includesBoard(active) ? active : savedCanvas.pages.find(includesBoard)
      if (page) revealBoard({ pageId: page.id, boardId })
    },
    [
      artifact.publicId,
      canvasLocation?.pageId,
      resolveElement,
      revealBoard,
      savedCanvas.pages,
      setInspectorTab,
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
      const resolved = resolveElement?.(element) ?? element
      setSelectedElement(artifact.publicId, resolved)
      const frameId = resolved.boardId ?? STANDALONE_BOARD_ID
      frames.current.get(frameId)?.send({ type: 'highlight', element: resolved })
    },
    [artifact.publicId, resolveElement, setSelectedElement],
  )
  const highlightLayer = useCallback(
    (
      boardId: string,
      message: Extract<Parameters<FrameConnection['send']>[0], { type: 'highlight' }>,
    ) => frames.current.get(boardId)?.send(message),
    [],
  )
  const inspection = useBoardInspection({
    artifactId: artifact.publicId,
    version: version.version,
    followHead: fixedVersion === undefined && !access,
    document: savedCanvas,
    current: canvasLocation,
    reveal: revealBoard,
    highlight: highlightLayer,
  })
  const inlineText = useInlineCanvasText({
    artifact,
    version,
    enabled: canEditText,
    activeBoardId: canvasLocation?.boardId,
    editing: boardEditing,
    send: (boardId, message) => frames.current.get(boardId)?.send(message),
    annotate: (element) => {
      handleHighlightElement(element)
      setInspectorTab('review')
    },
  })
  const onTextTarget = inlineText.onTextTarget
  const inspectedBoard = inspection.open ? canvasLocation?.boardId : inspection.pendingBoardId
  const watchBoard = canvas === savedCanvas ? inspectedBoard : undefined
  const renderBoard = useCallback(
    (board: CanvasBoard, purpose: BoardFramePurpose) => {
      const overview = purpose.type === 'overview'
      const register = purpose.type === 'focus' ? registerFocusedFrame : undefined
      return (
        <ArtifactFrame
          artifact={artifact}
          board={board}
          version={version}
          state={state}
          sandboxOrigin={sandboxOrigin}
          pins={overview ? versionPins : EMPTY_FEEDBACKS}
          onFocusPin={(feedback) => focusAndRemember(feedback, false)}
          purpose={purpose}
          register={overview ? registerFrame : register}
          onPlayable={onPlayable}
          watchLayers={overview && watchBoard === board.id}
          onLayers={inspection.onLayers}
          onLayerPicked={inspection.onLayerPicked}
          onTextTarget={onTextTarget}
          onVisualSelect={onVisualSelect}
        />
      )
    },
    [
      artifact,
      version,
      state,
      sandboxOrigin,
      versionPins,
      focusAndRemember,
      registerFrame,
      registerFocusedFrame,
      onPlayable,
      watchBoard,
      inspection.onLayers,
      inspection.onLayerPicked,
      onTextTarget,
      onVisualSelect,
    ],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {editorMounted && shareCanEdit ? (
          <div
            className={viewMode === 'edit' ? 'h-1/2 min-h-0 shrink-0 md:h-auto md:w-1/2' : 'hidden'}
          >
            <SplitCodeEditor
              artifact={artifact}
              version={version}
              latestVersion={latestVersion}
              notifyAgent={!access}
              onLivePreviewChange={setLiveEditSource}
              onVersionSaved={onVersionSaved}
              onVersionAdopted={onVersionAdopted}
            />
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* 工具视图只隐藏画布；切回时保留同一沙盒与用户视角。 */}
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
            boardEditing={canEditBoards ? boardEditing : undefined}
            historyEditing={canEditText ? boardEditing : undefined}
            textTools={canEditText ? inlineText.tools : undefined}
            pageEditing={
              canEditBoards && !boardEditing.draft
                ? { artifact, version, onVersionSaved }
                : undefined
            }
            renderBoard={renderBoard}
            canPlay={(board) =>
              playable?.artifactId === artifact.publicId &&
              playable.version === version.version &&
              playable.sources.get(board.id) === board.source
            }
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
              <pre className="rounded-xl border border-border bg-surface-subtle p-4 font-mono text-xs leading-6 text-ink">
                <code>{version.source}</code>
              </pre>
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
        version={version}
        stateSnapshot={state.snapshot}
        document={savedCanvas}
        location={canvasLocation}
        readOnly={
          Boolean(access) || fixedVersion !== undefined || version.version !== artifact.headVersion
        }
        canComment={canComment}
        editing={canEditBoards ? boardEditing : undefined}
        onEditText={canEditBoards && boardEditing.available ? inlineText.tools.edit : undefined}
        layers={watchBoard ? inspection.layers : null}
        selectedLayerId={inspection.selectedId}
        layersAvailable={canvas === savedCanvas}
        onHandoff={canvas === savedCanvas ? onHandoff : undefined}
        onAskAgent={canvas === savedCanvas ? onAskAgent : undefined}
        onSelectLayer={inspection.onSelect}
        onStartPicking={() => {
          if (canvasLocation) revealBoard(canvasLocation)
          else useWorkspaceStore.getState().setViewMode('preview')
        }}
        onNavigate={(location) => {
          if (canvasLocation?.boardId !== location.boardId)
            setSelectedElement(artifact.publicId, null)
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
