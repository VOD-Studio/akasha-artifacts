import { projectArtboard } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { type ArtifactDetailResponse, artifactKeys } from '../src/entities/artifact'
import { createAppRouter } from '../src/routes/router'

const publicId = 'WorkBenchCanvasExample'
const projectId = 'workbench-project'
const title = '结账流程'
const createdAt = '2026-11-24T00:00:00.000Z'
/** 供真实路由、版本链接和画布请求共用的固定画稿。 */
export const detail: ArtifactDetailResponse = {
  artifact: {
    publicId,
    projectId,
    slug: 'design/checkout',
    title,
    type: 'artboard',
    visibility: 'private',
    headVersion: 1,
    createdAt,
    updatedAt: createdAt,
  },
  version: {
    artifactId: publicId,
    version: 1,
    parentVersion: null,
    author: 'agent:cli',
    title,
    source: JSON.stringify({
      boards: [{ id: 'form', title: '确认订单', html: '<h1>确认订单</h1>' }],
    }),
    createdAt,
  },
  state: { artifactId: publicId, seq: 0, snapshot: {}, updatedAt: createdAt },
  rounds: [],
}

/** 挂载工作区实际路由；按需在请求边界提供该用例的写入结果。 */
export function openWorkspace(
  hub = false,
  canManage = true,
  detailFailure?: number,
  sourceFailure?: number,
  startAt = `/a/${publicId}${hub ? '?shared=1' : ''}`,
) {
  vi.stubGlobal('__AKASHA_CONFIG__', { hub, sandboxOrigin: 'http://127.0.0.1:24331' })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900)
  const endpoint = `/api/v1/artifacts/${publicId}`
  const projection = projectArtboard(detail.version.source, 1)
  if (!projection) throw new Error('结账稿缺少画板投影')
  const { source: _source, ...summary } = detail.version
  const responses = new Map<string, unknown>([
    [endpoint, { ...detail, version: summary, canvas: projection.index }],
    [
      `${endpoint}/boards?version=1&boardId=form`,
      { artifactId: publicId, version: 1, board: projection.contents[0] },
    ],
    [`${endpoint}/versions`, { versions: [summary] }],
    [`${endpoint}/management`, { canManage }],
    [`${endpoint}/agent-session`, { availability: 'unbound' }],
    [`${endpoint}/feedback`, { items: [] }],
    ['/api/v1/auth/session', { user: { login: 'reviewer', member: true } }],
    ['/api/v1/daemon/status', { sandboxPort: 24331 }],
    ['/api/v1/favorites', { artifactIds: [] }],
    ['/api/v1/projects', { projects: [] }],
    ['/api/v1/artifacts', { artifacts: [detail.artifact] }],
  ])
  let failDetailWith = detailFailure
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const { pathname, search } = new URL(String(input), window.location.origin)
    if (pathname === endpoint && search === '?version=1') {
      return sourceFailure ? new Response(null, { status: sourceFailure }) : Response.json(detail)
    }
    if (pathname === endpoint && failDetailWith) {
      const status = failDetailWith
      failDetailWith = undefined
      return new Response(null, { status })
    }
    if (pathname === `${endpoint}/boards`) {
      const board = responses.get(`${pathname}${search}`)
      return board ? Response.json(board) : new Response(null, { status: 404 })
    }
    if (responses.has(pathname)) return Response.json(responses.get(pathname))
    return new Response(null, { status: 404 })
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(artifactKeys.management(publicId, projectId), { canManage })
  const router = createAppRouter(createMemoryHistory({ initialEntries: [startAt] }))
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return {
    router,
    client,
    responses,
    denyAccess: () => {
      failDetailWith = 403
    },
  }
}
