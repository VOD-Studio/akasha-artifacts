import { useTheme } from '@akasha/ui'
import { UiLocaleProvider } from '@akasha/ui/locale'
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
import { useLayoutEffect } from 'react'
import { useWorkspaceStore } from '@/entities/workspace'
import { ArtifactCommandPalette } from '@/features/command-palette'
import { HubInvitationPage } from '@/features/hub'
import { HubSharingPolicyPage } from '@/features/hub-sharing-policy'
import { useLiveSync } from '@/features/live-sync'
import { hubArtifactPath } from '@/shared/config/hub-artifact'
import { isCloudHub } from '@/shared/config/runtime'
import { useMessages } from '@/shared/i18n'
import { LibraryShell } from '@/widgets/LibraryShell'
import { ArtifactRouteView } from './ArtifactRouteView'
import { ConnectionNotice } from './ConnectionNotice'
import { routeMessages } from './messages'

function RootLayout() {
  useTheme('system')
  const { locale, dir, t } = useMessages(routeMessages)
  useLayoutEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = dir
  }, [locale, dir])
  const navigate = useNavigate()
  const isWorkspace = useLocation({ select: (location) => location.pathname.startsWith('/a/') })
  const openArtifact = (to: string) => void navigate({ to })
  return (
    <UiLocaleProvider locale={locale}>
      <Outlet />
      {isWorkspace && <ArtifactCommandPalette onNavigate={openArtifact} />}
      <ConnectionNotice />
      <Toaster
        dir={dir}
        position={dir === 'rtl' ? 'bottom-left' : 'bottom-right'}
        containerAriaLabel={t('通知')}
        customAriaLabel={`${t('通知')} (⌥T)`}
        toastOptions={{ closeButtonAriaLabel: t('关闭') }}
      />
    </UiLocaleProvider>
  )
}

function LibraryPage() {
  const navigate = useNavigate()
  useLiveSync({ enabled: !isCloudHub() })
  useLayoutEffect(() => {
    useWorkspaceStore.getState().openArtifactView(null)
  }, [])
  const openArtifact = (publicId: string, destination?: 'hub') => {
    if (destination === 'hub') void navigate({ href: hubArtifactPath(publicId) })
    else void navigate({ to: '/a/$publicId', params: { publicId } })
  }
  return <LibraryShell onOpenArtifact={openArtifact} />
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

function InvitationRoute() {
  const { id } = useParams({ from: '/invite/$id' })
  const navigate = useNavigate()
  const openShared = (artifactId: string) =>
    void navigate({ href: hubArtifactPath(artifactId), replace: true })
  return <HubInvitationPage key={id} invitationId={id} onAccepted={openShared} />
}

function AdminSharingRoute() {
  const { id } = useParams({ from: '/admin/sharing/$id' })
  return <HubSharingPolicyPage key={id} artifactId={id} />
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

const invitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$id',
  component: InvitationRoute,
})

const adminSharingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin/sharing/$id',
  component: AdminSharingRoute,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  artifactHeadRoute,
  artifactVersionRoute,
  invitationRoute,
  adminSharingRoute,
])

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
