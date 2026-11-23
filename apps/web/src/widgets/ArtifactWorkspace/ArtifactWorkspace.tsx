import type {
  ElementRef,
  Feedback,
  JsonPatchOp,
  ReviewRound,
  SandboxToShellMessage,
} from '@akasha/protocol'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSelectionStore } from '../../entities/selection/store'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { SplitCodeEditor } from '../../features/code-editor/SplitCodeEditor'
import { selectActiveRound } from '../../features/review-rounds/round-utils'
import { VersionDiffView } from '../../features/version-diff/VersionDiffView'
import { useVisualEdit } from '../../features/visual-edit/useVisualEdit'
import { VisualEditPanel } from '../../features/visual-edit/VisualEditPanel'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import { syncProjectSelection } from '../../shared/api/client'
import { InspectorPanel } from '../InspectorPanel/InspectorPanel'
import { ArtifactCanvas } from './ArtifactCanvas'
import { ArtifactFrame, type FrameConnection } from './ArtifactFrame'
import {
  type CanvasBoard,
  createCanvasDocument,
  createCanvasElementResolver,
  STANDALONE_BOARD_ID,
} from './canvas-model'

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

  const selectedElement = useSelectionStore((s) => s.selectedByArtifact[artifact.publicId] ?? null)
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
  const canvas = useMemo(
    () =>
      createCanvasDocument(
        artifact.type,
        version.title,
        effectivePreviewSource,
        version.version,
        state.snapshot.props,
      ),
    [artifact.type, version.title, effectivePreviewSource, version.version, state.snapshot.props],
  )
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
  const renderBoard = useCallback(
    (board: CanvasBoard, interactive: boolean, focused = false) => (
      <ArtifactFrame
        artifact={artifact}
        board={board}
        version={version}
        state={state}
        sandboxOrigin={sandboxOrigin}
        pins={versionPins}
        interactive={interactive}
        focused={focused}
        register={focused ? registerFocusedFrame : registerFrame}
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
      onVisualSelect,
    ],
  )

  const handleHighlightElement = useCallback(
    (element: ElementRef) => {
      const resolved = resolveElement?.(element) ?? element
      setSelectedElement(artifact.publicId, resolved)
      const frameId = resolved.boardId ?? STANDALONE_BOARD_ID
      frames.current.get(frameId)?.send({ type: 'highlight', element: resolved })
    },
    [artifact.publicId, resolveElement, setSelectedElement],
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
            pageEditing={
              artifact.type === 'artboard' &&
              fixedVersion === undefined &&
              version.version === artifact.headVersion &&
              viewMode === 'preview'
                ? { artifact, version, onVersionSaved }
                : undefined
            }
            renderBoard={renderBoard}
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
        artifactType={artifact.type}
        source={version.source}
        stateSnapshot={state.snapshot}
        activeVersion={version.version}
        activeRound={activeRound}
        feedbacks={feedbacks}
        onHighlightElement={handleHighlightElement}
      />
      <VisualEditPanel controller={visual} />
    </div>
  )
}
