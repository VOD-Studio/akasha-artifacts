import type { JsonPatchOp } from '@akasha/protocol'
import { useEffect, useMemo, useRef } from 'react'
import { useWorkspaceStore } from '../../entities/workspace/store'
import { RuntimeErrorPanel } from '../../features/error-recovery/RuntimeErrorPanel'
import { VersionDiffView } from '../../features/version-diff/VersionDiffView'
import type { ArtifactDetailResponse } from '../../shared/api/client'
import {
  buildSandboxIframeUrl,
  createBridgeNonce,
  SANDBOX_IFRAME_SANDBOX_ATTR,
  SandboxBridgeHost,
} from '../../shared/bridge/host'

export interface ArtifactWorkspaceProps {
  detail: ArtifactDetailResponse
  versions: readonly ArtifactDetailResponse['version'][]
  sandboxOrigin: string
  onRegisterStateForwarder?: (forwarder: ((seq: number, ops: JsonPatchOp[]) => void) | null) => void
}

// Artifact 主画布工作区：通过独立 Origin + sandbox="allow-scripts"（严禁 allow-same-origin）隔离沙盒，
// 并在 Agent 推送新版本重绘时自动回填视图与控件快照、完整保留未提交批注草稿。
export function ArtifactWorkspace({
  detail,
  versions,
  sandboxOrigin,
  onRegisterStateForwarder,
}: ArtifactWorkspaceProps) {
  const { artifact, version, state } = detail
  const viewMode = useWorkspaceStore((s) => s.viewMode)
  const sandboxError = useWorkspaceStore((s) => s.sandboxErrorByArtifact[artifact.publicId] ?? null)
  const setSandboxError = useWorkspaceStore((s) => s.setSandboxError)
  const setPreservedView = useWorkspaceStore((s) => s.setPreservedView)
  const unsentDraft = useWorkspaceStore((s) => s.unsentDraftsByArtifact[artifact.publicId] ?? '')
  const setUnsentDraft = useWorkspaceStore((s) => s.setUnsentDraft)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const hostRef = useRef<SandboxBridgeHost | null>(null)
  const stateRef = useRef(state.snapshot)
  stateRef.current = state.snapshot
  const stateSeqRef = useRef(state.seq)
  stateSeqRef.current = state.seq
  const activeVersionRef = useRef(version.version)
  activeVersionRef.current = version.version
  const lastSyncedStateSeqRef = useRef<number>(-1)
  const lastRenderedKeyRef = useRef<string>('')

  const nonce = useMemo(() => {
    void artifact.publicId
    void sandboxOrigin
    return createBridgeNonce()
  }, [artifact.publicId, sandboxOrigin])

  const iframeSrc = useMemo(() => {
    const shellOrigin =
      typeof window !== 'undefined' && window.location.origin !== 'null'
        ? window.location.origin
        : 'http://127.0.0.1:24321'
    return buildSandboxIframeUrl(sandboxOrigin, nonce, shellOrigin)
  }, [sandboxOrigin, nonce])

  useEffect(() => {
    const host = new SandboxBridgeHost({
      sandboxOrigin,
      nonce,
      getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
    })
    hostRef.current = host
    lastSyncedStateSeqRef.current = -1
    lastRenderedKeyRef.current = ''

    const off = host.onMessage((msg) => {
      if (msg.type === 'viewState.snapshot') {
        setPreservedView(artifact.publicId, msg.state)
      } else if (msg.type === 'error') {
        setSandboxError(artifact.publicId, {
          version: activeVersionRef.current,
          phase: msg.phase,
          message: msg.message,
          stack: msg.stack,
          loc: msg.loc,
        })
      } else if (msg.type === 'rendered') {
        setSandboxError(artifact.publicId, null)
      }
    })

    host.start()
    onRegisterStateForwarder?.((seq, ops) => {
      if (seq > lastSyncedStateSeqRef.current) {
        lastSyncedStateSeqRef.current = seq
      }
      host.send({ type: 'state', seq, ops })
    })

    return () => {
      onRegisterStateForwarder?.(null)
      off()
      host.stop()
      hostRef.current = null
    }
  }, [
    artifact.publicId,
    sandboxOrigin,
    nonce,
    setPreservedView,
    setSandboxError,
    onRegisterStateForwarder,
  ])

  // 当 Artifact 版本或源码更新时下发 render，并清除旧版本遗留的错误面板，携带保态快照。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const existingErr = useWorkspaceStore.getState().sandboxErrorByArtifact[artifact.publicId]
    if (existingErr && existingErr.version !== version.version) {
      setSandboxError(artifact.publicId, null)
    }
    const preservedState = useWorkspaceStore.getState().preservedViewByArtifact[artifact.publicId]
    host.send({
      type: 'render',
      artifactType: artifact.type,
      version: version.version,
      source: version.source,
      state: stateRef.current,
      ...(preservedState ? { preservedState } : {}),
    })
    lastSyncedStateSeqRef.current = stateSeqRef.current
    lastRenderedKeyRef.current = `${artifact.publicId}:${version.version}`
  }, [artifact.publicId, artifact.type, version.version, version.source, setSandboxError])

  // 当 WS 断线 resync 刷新了服务端状态快照但源码版本未变时，仅以根路径 RFC 6902 replace 同步最新状态，
  // 确保不重挂载组件且后续增量补丁的父路径保持一致。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (lastRenderedKeyRef.current !== `${artifact.publicId}:${version.version}`) return
    if (state.seq <= lastSyncedStateSeqRef.current || state.seq < 1) return
    lastSyncedStateSeqRef.current = state.seq
    host.send({
      type: 'state',
      seq: state.seq,
      ops: [{ op: 'replace', path: '', value: state.snapshot }],
    })
  }, [artifact.publicId, version.version, state.seq, state.snapshot])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {sandboxError && sandboxError.version === version.version ? (
        <div className="shrink-0 border-b border-border bg-surface px-4 py-2">
          <RuntimeErrorPanel
            artifactId={artifact.publicId}
            projectId={artifact.projectId}
            version={sandboxError.version}
            source={version.source}
            error={sandboxError}
            onDismiss={() => setSandboxError(artifact.publicId, null)}
          />
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {/* 保持沙盒 iframe 挂载，切到 Diff/源码 再切回预览时不丢失运行时状态 */}
        <iframe
          ref={iframeRef}
          title={`${artifact.title} 隔离沙盒`}
          src={iframeSrc}
          sandbox={SANDBOX_IFRAME_SANDBOX_ATTR}
          referrerPolicy="no-referrer"
          className={viewMode === 'preview' ? 'block h-full w-full border-0 bg-white' : 'hidden'}
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

      {/* 草稿保态栏：热更新重绘期间保留用户未提交的批注草稿，M2 升级为完整 ReviewRound 提交栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-4 py-2">
        <span className="shrink-0 text-xs font-medium text-ink-muted">批注草稿</span>
        <input
          type="text"
          aria-label="未提交批注草稿"
          value={unsentDraft}
          onChange={(e) => setUnsentDraft(artifact.publicId, e.target.value)}
          placeholder="记录批注草稿（Agent 推送新版本重绘时草稿自动保留，M2 支持整轮提交回传）…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        {unsentDraft ? (
          <span className="shrink-0 text-[11px] text-ink-muted">已本地暂存（未发送）</span>
        ) : null}
      </div>
    </div>
  )
}
