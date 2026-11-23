import type {
  ElementRef,
  Feedback,
  JsonPatchOp,
  ReviewRound,
  SandboxToShellMessage,
} from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { selectionForVersion, useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { SplitCodeEditor } from '../../features/code-editor/SplitCodeEditor'
import { selectActiveRound } from '../../features/review-rounds/round-utils'
import { VersionDiffView } from '../../features/version-diff/VersionDiffView'
import { useVisualEdit } from '../../features/visual-edit/useVisualEdit'
import { VisualEditPanel } from '../../features/visual-edit/VisualEditPanel'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import { syncProjectSelection } from '../../shared/api/client'
import { InspectorPanel } from '../InspectorPanel/InspectorPanel'
import { ArtifactCanvas, type InspectorReveal } from './ArtifactCanvas'
import { ArtifactFrame, type BoardFramePurpose, type FrameConnection } from './ArtifactFrame'
import { BoardInspector } from './BoardInspector'
import {
  type CanvasBoard,
  type CanvasLocation,
  createCanvasDocument,
  createCanvasElementResolver,
  STANDALONE_BOARD_ID,
} from './canvas-model'
import { useBoardInspection } from './useBoardInspection'
import { useCanvasBoardEditing } from './useCanvasBoardEditing'

const EMPTY_FEEDBACKS: readonly Feedback[] = []

/** 画布工作区的输入。 */
export interface ArtifactWorkspaceProps {
  detail: ArtifactDetailResponse
  versions: readonly ArtifactDetailResponse['version'][]
  feedbacks?: readonly Feedback[]
  rounds?: readonly ReviewRound[]
  sandboxOrigin: string
  /** 链接里的定位；画布据此只定位一次。 */
  address?: string
  /** 固定查看的版本；省略时跟随头版本。 */
  fixedVersion?: number
  onClearAddress?: () => void
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
  rounds: roundsOverride,
  sandboxOrigin,
  address = '',
  fixedVersion,
  onClearAddress,
  onRegisterStateForwarder,
  onVersionSaved,
  onVersionAdopted,
}: ArtifactWorkspaceProps) {
  const { artifact, version, state } = detail
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
  const viewMode = useWorkspaceStore((s) => s.viewMode)
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
  const unsentDraft = useWorkspaceStore((s) => s.unsentDraftsByArtifact[artifact.publicId] ?? '')

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
    enabled: viewMode === 'preview' && latestVersion.version === version.version,
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
  // 将浏览器当前选区与未提交草稿防抖同步至本机 Daemon，供终端 Hook 在用户提问时无感注入上下文。
  useEffect(() => {
    const trimmedDraft = unsentDraft.trim()
    const sig = JSON.stringify({
      projectId: artifact.projectId,
      artifactId: artifact.publicId,
      element: selectedElement,
      draftText: trimmedDraft,
    })
    if (sig === lastSyncedSelectionRef.current) return
    const timer = setTimeout(() => {
      lastSyncedSelectionRef.current = sig
      void syncProjectSelection(artifact.projectId, {
        artifactId: artifact.publicId,
        element: selectedElement,
        ...(trimmedDraft ? { draftText: trimmedDraft } : {}),
      })
    }, 150)
    return () => clearTimeout(timer)
  }, [artifact.projectId, artifact.publicId, selectedElement, unsentDraft])

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
    artifact.type === 'artboard' &&
    fixedVersion === undefined &&
    version.version === artifact.headVersion &&
    viewMode === 'preview' &&
    savedCanvas.pages.every((page) => page.boards.every((board) => board.scoped))
  const boardEditing = useCanvasBoardEditing({
    artifact,
    version,
    enabled: canEditBoards,
    onVersionSaved,
  })
  const resolveElement = useMemo(
    () => (artifact.type === 'artboard' ? createCanvasElementResolver(canvas) : null),
    [artifact.type, canvas],
  )
  const versionPins = useMemo(
    () =>
      feedbacks.flatMap((feedback) => {
        if (feedback.version !== version.version || !feedback.element) return []
        const element = resolveElement?.(feedback.element) ?? feedback.element
        return [element === feedback.element ? feedback : { ...feedback, element }]
      }),
    [feedbacks, resolveElement, version.version],
  )
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
    document: savedCanvas,
    current: canvasLocation,
    reveal: revealBoard,
    highlight: highlightLayer,
  })
  const watchBoard = inspection.open && canvas === savedCanvas ? canvasLocation?.boardId : undefined
  const renderBoard = useCallback(
    (board: CanvasBoard, purpose: BoardFramePurpose) => (
      <ArtifactFrame
        artifact={artifact}
        board={board}
        version={version}
        state={state}
        sandboxOrigin={sandboxOrigin}
        pins={purpose.type === 'overview' ? versionPins : EMPTY_FEEDBACKS}
        purpose={purpose}
        register={
          purpose.type === 'overview'
            ? registerFrame
            : purpose.type === 'focus'
              ? registerFocusedFrame
              : undefined
        }
        onPlayable={onPlayable}
        watchLayers={purpose.type === 'overview' && watchBoard === board.id}
        onLayers={inspection.onLayers}
        onLayerPicked={inspection.onLayerPicked}
        onVisualSelect={onVisualSelect}
      />
    ),
    [
      artifact,
      version,
      state,
      sandboxOrigin,
      versionPins,
      registerFrame,
      registerFocusedFrame,
      onPlayable,
      watchBoard,
      inspection.onLayers,
      inspection.onLayerPicked,
      onVisualSelect,
    ],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {editorMounted ? (
          <div
            className={viewMode === 'edit' ? 'h-1/2 min-h-0 shrink-0 md:h-auto md:w-1/2' : 'hidden'}
          >
            <SplitCodeEditor
              artifact={artifact}
              version={version}
              latestVersion={latestVersion}
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
            pageLink={pageLink}
            reveal={inspectorReveal}
            onRevealHandled={clearInspectorReveal}
            onLocationChange={setCanvasLocation}
            boardEditing={canEditBoards ? boardEditing : undefined}
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

      <InspectorPanel
        artifactId={artifact.publicId}
        projectId={artifact.projectId}
        activeVersion={version.version}
        activeRound={activeRound}
        feedbacks={feedbacks}
        onHighlightElement={handleHighlightElement}
      />
      <BoardInspector
        artifact={artifact}
        version={version}
        stateSnapshot={state.snapshot}
        document={savedCanvas}
        location={canvasLocation}
        readOnly={fixedVersion !== undefined || version.version !== artifact.headVersion}
        layers={watchBoard ? inspection.layers : null}
        selectedLayerId={inspection.selectedId}
        layersAvailable={canvas === savedCanvas}
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
    </div>
  )
}
