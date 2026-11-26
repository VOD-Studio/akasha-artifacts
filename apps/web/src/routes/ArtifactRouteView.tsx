import {
  type ArtboardIndex,
  type ArtifactHandoffReference,
  type ArtifactWorkspaceDetail,
  isAnnotationKind,
  type JsonPatchOp,
} from '@akasha/protocol'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useArtifactVersionsQuery, useArtifactWorkspaceQuery } from '@/entities/artifact'
import { useDaemonStatusQuery } from '@/entities/daemon'
import { readAnnotationDraft, useArtifactFeedbackQuery } from '@/entities/feedback'
import { useSelectionStore } from '@/entities/selection'
import { useWorkspaceStore } from '@/entities/workspace'
import { AgentConversationPane, type ConversationTarget } from '@/features/agent-conversation'
import {
  ArtifactHandoffDialog,
  type ArtifactHandoffTarget,
  ArtifactShareDialog,
  ArtifactTransferDialog,
  type ArtifactTransferTarget,
} from '@/features/artifact-delivery'
import {
  ArtifactExportDialog,
  type CanvasExportSelection,
  type DesignExportTarget,
} from '@/features/export-design'
import { useLiveSync } from '@/features/live-sync'
import { isResourceUnavailable } from '@/shared/api/error'
import { useLocalArtifactRedirect } from '@/shared/config/local-artifact'
import { isCloudHub, resolveSandboxOrigin } from '@/shared/config/runtime'
import { ArtifactWorkspace } from '@/widgets/ArtifactWorkspace'
import { TopBar } from '@/widgets/TopBar'
import { OpeningArtifact, UnavailableArtifact } from './ArtifactRouteStatus'

type HandoffScope = Pick<ArtifactHandoffReference, 'pageId' | 'boardId' | 'element'>

function getHandoffReference(
  { artifact, version }: ArtifactWorkspaceDetail,
  scope?: HandoffScope,
): ArtifactHandoffReference {
  return {
    artifactId: artifact.publicId,
    projectId: artifact.projectId,
    version: version.version,
    ...scope,
  }
}

/** 装配工作区；历史版本、定位和分享权限继续由 URL 与服务端结果决定。 */
export function ArtifactRouteView({
  identifier,
  requestedVersion,
}: {
  identifier: string
  requestedVersion?: number
}) {
  const navigate = useNavigate()
  const address = useLocation({ select: (location) => location.hash })
  const search = useLocation({ select: (location) => location.searchStr })
  const [exportTarget, setExportTarget] = useState<DesignExportTarget | null>(null)
  const exportSelectionRef = useRef<(() => CanvasExportSelection | undefined) | null>(null)
  const [handoffTarget, setHandoffTarget] = useState<ArtifactHandoffTarget | null>(null)
  const [shareTarget, setShareTarget] = useState<
    (DesignExportTarget & { canvas?: ArtboardIndex }) | null
  >(null)
  const [transferTarget, setTransferTarget] = useState<ArtifactTransferTarget | null>(null)
  const [expiredShare, setExpiredShare] = useState<string | null>(null)
  const [agentPanel, setAgentPanel] = useState<{
    artifactId: string
    open: boolean
    target?: ConversationTarget
  } | null>(null)
  const agentToggleRef = useRef<HTMLButtonElement>(null)
  const clearAddress = useCallback(() => {
    void navigate({
      hash: (previous) => {
        const location = new URLSearchParams(previous)
        location.delete('page')
        location.delete('board')
        location.delete('play')
        return location.toString()
      },
      search: true,
      replace: true,
      resetScroll: false,
    })
  }, [navigate])
  const rememberThread = useCallback(
    (id: string) => {
      void navigate({
        hash: (previous) => {
          const location = new URLSearchParams(previous)
          location.set('thread', id)
          return location.toString()
        },
        search: true,
        replace: true,
        resetScroll: false,
      })
    },
    [navigate],
  )
  const { data: daemonStatus } = useDaemonStatusQuery()
  const detailQuery = useArtifactWorkspaceQuery(identifier, requestedVersion)
  const cloudHub = isCloudHub()
  const checkingHubAccess = cloudHub && !detailQuery.isFetchedAfterMount && !detailQuery.isError
  const denied = isResourceUnavailable(detailQuery.error)
  const shareAccess = detailQuery.data?.access
  const expiresAt = shareAccess?.expiresAt
  const shareExpired = Boolean(expiresAt && expiredShare === expiresAt)
  const probingLocal = useLocalArtifactRedirect(
    identifier,
    requestedVersion,
    detailQuery.isSuccess &&
      !checkingHubAccess &&
      !detailQuery.data.hubRestricted &&
      !shareAccess &&
      !new URLSearchParams(search).has('shared'),
  )
  useEffect(() => {
    if (!expiresAt) return
    const expire = () => setExpiredShare(expiresAt)
    const remaining = Date.parse(expiresAt) - Date.now()
    if (remaining <= 0) {
      expire()
      return
    }
    const timer = window.setTimeout(expire, remaining)
    return () => window.clearTimeout(timer)
  }, [expiresAt])
  const publicId = detailQuery.data?.artifact.publicId
  const resolvedPublicId = publicId ?? identifier
  const versionsQuery = useArtifactVersionsQuery(resolvedPublicId)
  const feedbackQuery = useArtifactFeedbackQuery(
    resolvedPublicId,
    shareAccess,
    !cloudHub || (Boolean(publicId) && !checkingHubAccess && !denied && !shareExpired),
  )

  useLayoutEffect(() => {
    if (!publicId) return
    const workspace = useWorkspaceStore.getState()
    workspace.openArtifactView(publicId)
    useSelectionStore.getState().setFocusedFeedbackId(null)
    if (readAnnotationDraft(publicId)) workspace.setInspectorTab('review')
  }, [publicId])

  const stateForwarderRef = useRef<((seq: number, ops: JsonPatchOp[]) => void) | null>(null)
  const registerStateForwarder = useCallback(
    (fn: ((seq: number, ops: JsonPatchOp[]) => void) | null) => {
      stateForwarderRef.current = fn
    },
    [],
  )

  // 兼容旧 slug 路径：解析出真实不可变 publicId 后无痕替换为规范路由。
  useEffect(() => {
    const actualPublicId = detailQuery.data?.artifact.publicId
    if (!actualPublicId || actualPublicId === identifier) return
    if (requestedVersion !== undefined) {
      void navigate({
        to: '/a/$publicId/v/$version',
        params: { publicId: actualPublicId, version: String(requestedVersion) },
        hash: address,
        search: true,
        replace: true,
      })
    } else {
      void navigate({
        to: '/a/$publicId',
        params: { publicId: actualPublicId },
        hash: address,
        search: true,
        replace: true,
      })
    }
  }, [detailQuery.data?.artifact.publicId, identifier, requestedVersion, address, navigate])

  useLiveSync({
    artifactId: publicId,
    projectId: shareAccess ? undefined : detailQuery.data?.artifact.projectId,
    enabled: Boolean(publicId) && !checkingHubAccess && !denied && !probingLocal && !shareExpired,
    onStatePatched: (evt) => {
      if (
        requestedVersion === undefined &&
        !shareAccess &&
        evt.artifactId === detailQuery.data?.artifact.publicId
      ) {
        stateForwarderRef.current?.(evt.stateSeq, evt.ops)
      }
    },
  })

  if (checkingHubAccess || probingLocal || detailQuery.isLoading) return <OpeningArtifact />

  const backToLibrary = () => void navigate({ to: '/' })
  const retry = () => void detailQuery.refetch()
  // 暂时读不到服务端时保留画布和未保存代码；明确撤回读取权限时不展示旧缓存。
  if (!detailQuery.data || denied || shareExpired) {
    return (
      <UnavailableArtifact
        error={detailQuery.error}
        shareExpired={shareExpired}
        retrying={detailQuery.isFetching}
        onRetry={denied || shareExpired ? undefined : retry}
        onBack={backToLibrary}
      />
    )
  }
  const viewingFixedVersion = shareAccess?.version ?? requestedVersion

  const detail = detailQuery.data
  const versions =
    shareAccess?.version !== undefined ? [detail.version] : (versionsQuery.data ?? [detail.version])
  const feedbacks = feedbackQuery.data?.items ?? []
  const rounds = detail.rounds
  const sandboxOrigin = resolveSandboxOrigin(daemonStatus?.sandboxPort)
  const openExport = (boardId?: string) => {
    const selection = exportSelectionRef.current?.()
    setExportTarget({
      artifact: detail.artifact,
      version: detail.version,
      boardId,
      selection:
        selection?.artifactId === detail.artifact.publicId &&
        selection.version === detail.version.version
          ? selection
          : undefined,
    })
  }
  const openHandoff = (label: string, scope?: HandoffScope) =>
    setHandoffTarget({ label, reference: getHandoffReference(detail, scope) })
  const canTalkToAgent = !cloudHub && !shareAccess
  const agent =
    canTalkToAgent && agentPanel?.artifactId === detail.artifact.publicId ? agentPanel : null

  const openAgent = (target?: ConversationTarget) => {
    useWorkspaceStore.getState().setInspectorTab(null)
    setAgentPanel({
      artifactId: detail.artifact.publicId,
      open: true,
      target: target ?? agent?.target,
    })
  }
  const closeAgent = () => {
    setAgentPanel((current) => current && { ...current, open: false })
    agentToggleRef.current?.focus({ preventScroll: true })
  }
  const toggleAgent = () => {
    if (agent?.open) closeAgent()
    else openAgent()
  }
  const clearAgentTarget = () => {
    setAgentPanel((current) => current && { ...current, target: undefined })
  }
  const askAgent = (label: string, scope: HandoffScope) =>
    openAgent({ label, reference: getHandoffReference(detail, scope) })
  const openShare = () =>
    setShareTarget({ artifact: detail.artifact, version: detail.version, canvas: detail.canvas })
  const openVersion = (version?: number, nextHash?: string) => {
    const publicId = detail.artifact.publicId
    const hash = nextHash !== undefined ? nextHash : address
    if (version === undefined) {
      void navigate({ to: '/a/$publicId', params: { publicId }, hash, search: true })
      return
    }
    void navigate({
      to: '/a/$publicId/v/$version',
      params: { publicId, version: String(version) },
      hash,
      search: true,
    })
  }
  const returnToHead = () => {
    if (requestedVersion !== undefined) openVersion()
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <TopBar
        key={`topbar:${detail.artifact.publicId}`}
        artifact={detail.artifact}
        version={detail.version}
        versions={versions}
        fixedVersion={viewingFixedVersion}
        shareAccess={shareAccess}
        onShare={cloudHub && !shareAccess ? openShare : undefined}
        onTransfer={
          shareAccess
            ? undefined
            : (kind) =>
                setTransferTarget({ kind, artifact: detail.artifact, version: detail.version })
        }
        feedbackCount={feedbacks.reduce(
          (count, feedback) => count + Number(isAnnotationKind(feedback.kind)),
          0,
        )}
        hasActiveRound={rounds.some((round) => round.status !== 'closed')}
        onExport={() => openExport()}
        onHandoff={() => openHandoff(detail.version.title)}
        agentOpen={Boolean(agent?.open)}
        agentToggleRef={agentToggleRef}
        onToggleAgent={canTalkToAgent ? toggleAgent : undefined}
        onBackToLibrary={backToLibrary}
        onSelectVersion={openVersion}
      />
      <main className="relative flex min-h-0 min-w-0 flex-1">
        {agent && (
          <AgentConversationPane
            key={`${detail.artifact.projectId}:${detail.artifact.publicId}`}
            artifactId={detail.artifact.publicId}
            projectId={detail.artifact.projectId}
            open={agent.open}
            target={agent.target}
            onClose={closeAgent}
            onClearTarget={clearAgentTarget}
          />
        )}
        <div className={`flex min-h-0 min-w-0 flex-1 ${agent?.open ? 'max-lg:invisible' : ''}`}>
          <ArtifactWorkspace
            key={JSON.stringify([
              detail.artifact.projectId,
              detail.artifact.publicId,
              shareAccess?.role,
              expiresAt,
            ])}
            detail={detail}
            versions={versions}
            feedbacks={feedbacks}
            threads={feedbackQuery.data?.threads}
            rounds={rounds}
            sandboxOrigin={sandboxOrigin}
            address={address}
            fixedVersion={viewingFixedVersion}
            onClearAddress={clearAddress}
            onRememberThread={rememberThread}
            onOpenVersion={openVersion}
            onExportBoard={openExport}
            exportSelectionRef={exportSelectionRef}
            onHandoff={openHandoff}
            onAskAgent={canTalkToAgent ? askAgent : undefined}
            onOpenAgentConversation={canTalkToAgent ? () => openAgent() : undefined}
            onRegisterStateForwarder={registerStateForwarder}
            onVersionSaved={returnToHead}
            onVersionAdopted={returnToHead}
          />
        </div>
      </main>
      {exportTarget?.artifact.publicId === detail.artifact.publicId ? (
        <ArtifactExportDialog target={exportTarget} onClose={() => setExportTarget(null)} />
      ) : null}
      {handoffTarget?.reference.artifactId === detail.artifact.publicId ? (
        <ArtifactHandoffDialog target={handoffTarget} onClose={() => setHandoffTarget(null)} />
      ) : null}
      {!shareAccess && shareTarget?.artifact.publicId === detail.artifact.publicId ? (
        <ArtifactShareDialog
          artifact={shareTarget.artifact}
          version={shareTarget.version}
          canvas={shareTarget.canvas}
          onClose={() => setShareTarget(null)}
        />
      ) : null}
      {!shareAccess && transferTarget?.artifact.publicId === detail.artifact.publicId ? (
        <ArtifactTransferDialog
          target={transferTarget}
          onCopy={(publicId) => void navigate({ to: '/a/$publicId', params: { publicId } })}
          onClose={() => setTransferTarget(null)}
        />
      ) : null}
    </div>
  )
}
