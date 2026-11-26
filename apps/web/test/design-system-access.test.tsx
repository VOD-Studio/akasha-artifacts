// @vitest-environment jsdom
import type { ArtifactWorkspaceDetail, DesignSystemSnapshot } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemWorkspace } from '../src/features/design-system/ui/SystemWorkspace'
import { detailFor } from './canvas-test-fixture'

const snapshot: DesignSystemSnapshot = {
  draft: {
    origin: { kind: 'local', label: '独立品牌' },
    files: [{ kind: 'guidelines', path: 'brand.md', content: '保留字距' }],
    guidance: { color: '#333', fontFamily: 'serif', spacing: 12, instructions: '正文使用衬线字体' },
    components: [],
  },
  sourceVersion: 'a'.repeat(64),
  previewSource: 'export default function Brand() { return <p>独立品牌</p> }',
  compiledRanges: [],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('分享读者不请求管理权，设计系统移动后须按目标项目重新授权', async () => {
  const detail = detailFor(1, JSON.stringify(snapshot))
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ canManage: true }))
    .mockResolvedValueOnce(Response.json({ canManage: false }))
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  const workspace = (projectId: string, access?: ArtifactWorkspaceDetail['access']) => (
    <QueryClientProvider client={cache}>
      <SystemWorkspace
        detail={{
          ...detail,
          artifact: { ...detail.artifact, type: 'design-system', projectId },
          access,
        }}
        versions={[]}
        sandboxOrigin="http://sandbox.test"
        onBack={vi.fn()}
        onVersion={vi.fn()}
        onOpenArtifact={vi.fn()}
      />
    </QueryClientProvider>
  )
  const view = render(workspace('source', { role: 'view', expiresAt: '2099-01-01T00:00:00Z' }))
  expect(screen.getByText('独立品牌')).toBeDefined()
  expect(fetcher).not.toHaveBeenCalled()
  view.rerender(workspace('source'))
  await screen.findByRole('button', { name: '重新同步' })
  view.rerender(workspace('destination'))
  expect(screen.queryByRole('button', { name: '重新同步' })).toBeNull()
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  expect(screen.queryByRole('button', { name: '生成画板' })).toBeNull()
})
