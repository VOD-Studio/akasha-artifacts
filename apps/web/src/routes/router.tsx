import type { JsonPatchOp } from '@akasha/protocol'
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
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { useArtifactDetailQuery, useArtifactVersionsQuery } from '../entities/artifact/queries'
import { useDaemonStatusQuery } from '../entities/daemon/queries'
import { useArtifactFeedbackQuery } from '../entities/feedback/queries'
import { ArtifactCommandPalette } from '../features/command-palette/ArtifactCommandPalette'
import { useLiveSync } from '../features/live-sync/useLiveSync'
import { resolveSandboxOrigin } from '../shared/config/runtime'
import { ArtifactWorkspace } from '../widgets/ArtifactWorkspace/ArtifactWorkspace'
import { LibraryShell } from '../widgets/LibraryShell/LibraryShell'
import { TopBar } from '../widgets/TopBar/TopBar'

function RootLayout() {
  const navigate = useNavigate()
  return (
    <>
      <Outlet />
      <ArtifactCommandPalette onNavigate={(to) => void navigate({ to })} />
      <Toaster position="bottom-right" />
    </>
  )
}

function LibraryPage() {
  const navigate = useNavigate()
  useLiveSync({})
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
  const { data: daemonStatus } = useDaemonStatusQuery()
  const detailQuery = useArtifactDetailQuery(identifier, requestedVersion)
  const resolvedPublicId = detailQuery.data?.artifact.publicId ?? identifier
  const versionsQuery = useArtifactVersionsQuery(resolvedPublicId)
  const feedbackQuery = useArtifactFeedbackQuery(resolvedPublicId)

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
        replace: true,
      })
    } else {
      void navigate({
        to: '/a/$publicId',
        params: { publicId: actualPublicId },
        replace: true,
      })
    }
  }, [detailQuery.data?.artifact.publicId, identifier, requestedVersion, navigate])

  useLiveSync({
    artifactId: detailQuery.data?.artifact.publicId,
    projectId: detailQuery.data?.artifact.projectId,
    enabled: Boolean(detailQuery.data?.artifact.publicId),
    onStatePatched: (evt) => {
      if (
        requestedVersion === undefined &&
        evt.artifactId === detailQuery.data?.artifact.publicId
      ) {
        stateForwarderRef.current?.(evt.stateSeq, evt.ops)
      }
    },
  })

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-canvas text-sm text-ink-muted">
        <Spinner size={16} />
        正在加载 Artifact…
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
        <Button variant="outline" onClick={() => void navigate({ to: '/' })}>
          返回多项目库
        </Button>
      </div>
    )
  }

  const detail = detailQuery.data
  const versions = versionsQuery.data ?? [detail.version]
  const feedbacks = feedbackQuery.data?.items ?? []
  const rounds = feedbackQuery.data?.rounds ?? detail.rounds
  const sandboxOrigin = resolveSandboxOrigin(daemonStatus?.sandboxPort)

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopBar
        artifact={detail.artifact}
        version={detail.version}
        versions={versions}
        feedbackCount={feedbacks.length}
        onBackToLibrary={() => void navigate({ to: '/' })}
        onSelectVersion={(ver) => {
          if (ver === undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
            })
          } else {
            void navigate({
              to: '/a/$publicId/v/$version',
              params: { publicId: detail.artifact.publicId, version: String(ver) },
            })
          }
        }}
      />
      <ArtifactWorkspace
        detail={detail}
        versions={versions}
        feedbacks={feedbacks}
        rounds={rounds}
        sandboxOrigin={sandboxOrigin}
        onRegisterStateForwarder={registerStateForwarder}
        onVersionSaved={() => {
          if (requestedVersion !== undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
            })
          }
        }}
        onVersionAdopted={() => {
          if (requestedVersion !== undefined) {
            void navigate({
              to: '/a/$publicId',
              params: { publicId: detail.artifact.publicId },
            })
          }
        }}
      />
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
