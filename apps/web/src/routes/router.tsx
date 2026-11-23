import { isAnnotationKind, type JsonPatchOp } from '@akasha/protocol'
import { Alert } from '@akasha/ui/alert'
import { Button } from '@akasha/ui/button'
import { Spinner } from '@akasha/ui/indicator'
import { Toaster } from '@akasha/ui/sonner'
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useArtifactDetailQuery, useArtifactVersionsQuery } from '../entities/artifact/queries'
import { useDaemonStatusQuery } from '../entities/daemon/queries'
import { readAnnotationDraft } from '../entities/feedback/annotation-draft'
import { useArtifactFeedbackQuery } from '../entities/feedback/queries'
import { useSelectionStore } from '../entities/selection/store'
import { useWorkspaceStore } from '../entities/workspace/store'
import { ArtifactCommandPalette } from '../features/command-palette/ArtifactCommandPalette'
import { HubAccountButton } from '../features/hub/HubActions'
import { useLiveSync } from '../features/live-sync/useLiveSync'
import { useLocalArtifactRedirect } from '../shared/config/local-artifact'
import { isCloudHub, resolveSandboxOrigin } from '../shared/config/runtime'
import {
  ArtifactExportDialog,
  type DesignExportTarget,
} from '../widgets/ArtifactWorkspace/ArtifactExportDialog'
import { ArtifactWorkspace } from '../widgets/ArtifactWorkspace/ArtifactWorkspace'
import { LibraryShell } from '../widgets/LibraryShell/LibraryShell'
import { TopBar } from '../widgets/TopBar/TopBar'

function RootLayout() {
  const navigate = useNavigate()
  const isLibrary = useLocation({ select: (location) => location.pathname === '/' })
  return (
    <>
      <Outlet />
      {!isLibrary ? <ArtifactCommandPalette onNavigate={(to) => void navigate({ to })} /> : null}
      <Toaster position="bottom-right" />
    </>
  )
}

function LibraryPage() {
  const navigate = useNavigate()
  useLiveSync({ enabled: !isCloudHub() })
  useLayoutEffect(() => {
    useWorkspaceStore.getState().openArtifactView(null)
  }, [])
  return (
    <LibraryShell
      onOpenArtifact={(publicId) => void navigate({ to: '/a/$publicId', params: { publicId } })}
    />
  )
}

function ArtifactRouteView({
  identifier,
  requestedVersion,
}: {
  identifier: string
  requestedVersion?: number
}) {
  const navigate = useNavigate()
  const address = useLocation({ select: (location) => location.hash })
  const [exportTarget, setExportTarget] = useState<DesignExportTarget | null>(null)
  const clearAddress = useCallback(() => {
    void navigate({
      hash: (previous) => {
        const location = new URLSearchParams(previous)
        location.delete('page')
        location.delete('board')
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
  const probingLocal = useLocalArtifactRedirect(identifier, requestedVersion)
  const { data: daemonStatus } = useDaemonStatusQuery()
  const detailQuery = useArtifactDetailQuery(identifier, requestedVersion)
  const publicId = detailQuery.data?.artifact.publicId
  const resolvedPublicId = publicId ?? identifier
  const versionsQuery = useArtifactVersionsQuery(resolvedPublicId)
  const feedbackQuery = useArtifactFeedbackQuery(resolvedPublicId)

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
    projectId: detailQuery.data?.artifact.projectId,
    enabled: Boolean(publicId) && !probingLocal,
    onStatePatched: (evt) => {
      if (
        requestedVersion === undefined &&
        evt.artifactId === detailQuery.data?.artifact.publicId
      ) {
        stateForwarderRef.current?.(evt.stateSeq, evt.ops)
      }
    },
  })

  if (probingLocal || detailQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-canvas text-sm text-ink-muted">
        <Spinner size={16} />
        {probingLocal ? '正在查找本机制品…' : '正在加载 Artifact…'}
      </div>
    )
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-canvas p-6">
        <div className="w-full max-w-md">
          <Alert
            tone="danger"
            title="无法加载 Artifact"
            description={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : `未找到标识为 "${identifier}" 的 Artifact`
            }
          />
        </div>
        <HubAccountButton />
        <Button variant="outline" onClick={() => void navigate({ to: '/' })}>
          返回多项目库
        </Button>
      </div>
    )
  }

  const detail = detailQuery.data
  const versions = versionsQuery.data ?? [detail.version]
  const feedbacks = feedbackQuery.data?.items ?? []
  const rounds = detail.rounds
  const sandboxOrigin = resolveSandboxOrigin(daemonStatus?.sandboxPort)
  const openExport = (boardId?: string) =>
    setExportTarget({ artifact: detail.artifact, version: detail.version, boardId })

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <TopBar
        key={`topbar:${detail.artifact.publicId}`}
        artifact={detail.artifact}
        version={detail.version}
        versions={versions}
        fixedVersion={requestedVersion}
        feedbackCount={feedbacks.reduce(
          (count, feedback) => count + Number(isAnnotationKind(feedback.kind)),
          0,
        )}
        hasActiveRound={rounds.some((round) => round.status !== 'closed')}
        onExport={() => openExport()}
        onBackToLibrary={() => void navigate({ to: '/' })}
        onSelectVersion={(ver) => {
          if (ver === undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
              hash: address,
              search: true,
            })
          } else {
            void navigate({
              to: '/a/$publicId/v/$version',
              params: { publicId: detail.artifact.publicId, version: String(ver) },
              hash: address,
              search: true,
            })
          }
        }}
      />
      <ArtifactWorkspace
        key={detail.artifact.publicId}
        detail={detail}
        versions={versions}
        feedbacks={feedbacks}
        threads={feedbackQuery.data?.threads}
        rounds={rounds}
        sandboxOrigin={sandboxOrigin}
        address={address}
        fixedVersion={requestedVersion}
        onClearAddress={clearAddress}
        onRememberThread={rememberThread}
        onExportBoard={openExport}
        onRegisterStateForwarder={registerStateForwarder}
        onVersionSaved={() => {
          if (requestedVersion !== undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
              hash: address,
              search: true,
            })
          }
        }}
        onVersionAdopted={() => {
          if (requestedVersion !== undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
              hash: address,
              search: true,
            })
          }
        }}
      />
      {exportTarget?.artifact.publicId === detail.artifact.publicId ? (
        <ArtifactExportDialog target={exportTarget} onClose={() => setExportTarget(null)} />
      ) : null}
    </div>
  )
}

function ArtifactHeadPage() {
  const { publicId } = useParams({ from: '/a/$publicId' })
  return <ArtifactRouteView identifier={publicId} />
}

function ArtifactVersionPage() {
  const { publicId, version } = useParams({ from: '/a/$publicId/v/$version' })
  const parsed = Number.parseInt(version, 10)
  return (
    <ArtifactRouteView
      identifier={publicId}
      requestedVersion={Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined}
    />
  )
}

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LibraryPage,
})

const artifactHeadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/a/$publicId',
  component: ArtifactHeadPage,
})

const artifactVersionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/a/$publicId/v/$version',
  component: ArtifactVersionPage,
})

const routeTree = rootRoute.addChildren([indexRoute, artifactHeadRoute, artifactVersionRoute])

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    history: history ?? (typeof window !== 'undefined' ? createBrowserHistory() : undefined),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
