// @vitest-environment jsdom
import type { Artifact, Version } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { artifactKeys } from '../src/entities/artifact'
import { setLocale } from '../src/shared/i18n'
import { ArtifactExportDialog } from '../src/widgets/ArtifactWorkspace'
import { ArtifactTitleMenu } from '../src/widgets/TopBar/ArtifactTitleMenu'

const createdAt = '2026-11-22T10:00:00.000Z'
const artifact: Artifact = {
  publicId: 'ExportLocale001',
  projectId: 'studio',
  slug: 'flow',
  type: 'artboard',
  visibility: 'private',
  title: '予約',
  headVersion: 7,
  createdAt,
  updatedAt: createdAt,
}
const version: Version = {
  artifactId: artifact.publicId,
  version: 7,
  parentVersion: 6,
  author: 'agent:cli',
  title: artifact.title,
  createdAt,
  source: JSON.stringify({
    pages: [{ id: 'flow', title: '予約' }],
    boards: [
      { id: 'two', title: '支払い', pageId: 'flow', position: { x: 500, y: 0 } },
      { id: 'one', title: '注文', pageId: 'flow', position: { x: 0, y: 0 } },
    ],
  }),
}
const selection = {
  artifactId: artifact.publicId,
  version: 7,
  pageId: 'flow',
  columns: 2,
  boardIds: ['two', 'one'],
}

function ExportWorkspace() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ArtifactTitleMenu
        artifact={artifact}
        canManage={false}
        onQuickJump={() => {}}
        onShowTool={() => {}}
        onExport={() => setOpen(true)}
      />
      {open && (
        <ArtifactExportDialog
          target={{ artifact, version, selection }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  vi.restoreAllMocks()
})

const languages = {
  en: {
    menu: 'Artifact menu',
    action: 'Export',
    scope: 'Export scope',
    selection: 'Selection (2 artboards)',
    dialog: 'Export artifact',
    cancel: 'Cancel',
  },
  de: {
    menu: 'Werkmenü',
    action: 'Exportieren',
    scope: 'Exportumfang',
    selection: 'Auswahl (2 Zeichenflächen)',
    dialog: 'Werk exportieren',
    cancel: 'Abbrechen',
  },
  ar: {
    menu: 'قائمة العمل',
    action: 'تصدير',
    scope: 'نطاق التصدير',
    selection: 'التحديد (لوحتان)',
    dialog: 'تصدير العمل',
    cancel: 'إلغاء',
  },
} as const

it.each(['en', 'de', 'ar'] as const)(
  '%s：作品菜单导出选区，切换语言保留页序和焦点',
  async (initial) => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    client.setQueryData(artifactKeys.favorites, [])
    setLocale(initial)
    render(
      <QueryClientProvider client={client}>
        <ExportWorkspace />
      </QueryClientProvider>,
    )
    const first = languages[initial]
    const menu = screen.getByRole('button', { name: first.menu })
    menu.focus()
    fireEvent.keyDown(menu, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: first.action }))
    const scope = await screen.findByRole('combobox', { name: first.scope })
    scope.focus()
    fireEvent.click(scope)
    fireEvent.click(screen.getByRole('option', { name: first.selection }))
    expect(document.activeElement).toBe(scope)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '注文',
      '支払い',
    ])
    const next = initial === 'de' ? 'ar' : 'de'
    act(() => setLocale(next))
    expect(screen.getByRole('dialog', { name: languages[next].dialog })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: languages[next].scope })).toBe(scope)
    await waitFor(() => expect(scope.textContent).toContain(languages[next].selection))
    expect(document.activeElement).toBe(scope)
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '注文',
      '支払い',
    ])
    fireEvent.click(screen.getByRole('button', { name: languages[next].cancel }))
    await waitFor(() => expect(document.activeElement).toBe(menu))
  },
)

it('定版导出权限被撤销后，切换中文和英文显示同一次请求的诊断', async () => {
  const request = vi
    .spyOn(window, 'fetch')
    .mockResolvedValue(
      Response.json(
        { error: { code: 'FORBIDDEN', message: '该版本已撤销访问权' } },
        { status: 403 },
      ),
    )
  setLocale('en')
  render(<ArtifactExportDialog target={{ artifact, version, selection }} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(
    'You do not have permission to perform this action. No file was downloaded.',
  )
  act(() => setLocale('zh-CN'))
  expect(alert.textContent).toBe('该版本已撤销访问权。未下载文件。')
  expect(request).toHaveBeenCalledTimes(1)
})
