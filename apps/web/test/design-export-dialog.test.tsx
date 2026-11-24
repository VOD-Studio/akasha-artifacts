// @vitest-environment jsdom
import type { Artifact, Version } from '@akasha/protocol'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ArtifactExportDialog } from '../src/widgets/ArtifactWorkspace/ArtifactExportDialog'

const now = '2026-11-22T10:00:00.000Z'
const artifact: Artifact = {
  publicId: 'DesignExportProtected001',
  projectId: 'protected-design',
  slug: 'design/plan',
  title: '受保护的设计',
  type: 'html',
  visibility: 'private',
  headVersion: 4,
  createdAt: now,
  updatedAt: now,
}
const version: Version = {
  artifactId: artifact.publicId,
  version: 2,
  parentVersion: 1,
  author: 'agent:cli',
  title: artifact.title,
  source: '<h1>先前读取的内容</h1>',
  createdAt: now,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('确认下载时必须重新读取面板中的固定版本，权限失效不渲染已缓存的内容', async () => {
  const request = vi
    .spyOn(window, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { code: 'FORBIDDEN', message: '该快照不再允许读取' } },
        { status: 403 },
      ),
    )
  render(
    <ArtifactExportDialog target={{ artifact, version, boardId: 'main' }} onClose={() => {}} />,
  )
  expect(screen.getByRole('combobox', { name: '导出范围' }).textContent).toBe(version.title)
  expect(screen.getByRole('radio', { name: 'PNG' })).toHaveProperty('checked', true)
  fireEvent.click(screen.getByRole('button', { name: '导出' }))
  expect((await screen.findByRole('alert')).textContent).toContain('该快照不再允许读取')
  expect(request).toHaveBeenCalledWith(
    `/api/v1/artifacts/${artifact.publicId}?version=2`,
    expect.objectContaining({ credentials: 'include' }),
  )
  expect(screen.queryByTitle('画板渲染任务')).toBeNull()
})
