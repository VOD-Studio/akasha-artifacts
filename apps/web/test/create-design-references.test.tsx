// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import {
  type AgentConversation,
  AgentDesignInputSchema,
  type AgentReferenceSummary,
  RemoveAgentReferenceSchema,
  StageAgentReferenceSchema,
} from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryShell } from '../src/widgets/LibraryShell'

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwmnkGAAKYAZgAOdgfAAAAAElFTkSuQmCC'
const word = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  ),
  'word/document.xml': strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>COBALT-SQUARE-407</w:t></w:r></w:p></w:body></w:document>',
  ),
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('作品库按预览清单发送图片和文档，解析失败保留草稿且不发送已移除项', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  const projectId = 'checkout'
  const published: AgentConversation = {
    id: crypto.randomUUID(),
    harness: 'codex',
    projectId,
    turns: [],
  }
  const materials = new Map<string, AgentReferenceSummary>()
  const scopes: string[] = []
  const sent: unknown[] = []
  const removed: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    const payload = () => JSON.parse(String(options?.body))
    switch (String(url)) {
      case '/api/v1/projects':
        return Response.json({
          projects: [
            {
              id: projectId,
              rootPath: '/checkout',
              name: '订单设计',
              lastActiveAt: '2026-11-26T00:00:00Z',
            },
          ],
        })
      case '/api/v1/artifacts':
        return Response.json({ artifacts: [] })
      case '/api/v1/favorites':
        return Response.json({ artifactIds: [] })
      case '/api/v1/agent/connections':
        return Response.json({
          connections: [{ projectId, harness: 'codex', availability: 'ready' }],
        })
      case '/api/v1/agent/references': {
        if (options?.method === 'DELETE') {
          const { id } = RemoveAgentReferenceSchema.parse(payload())
          removed.push(id)
          return new Response(null, { status: 204 })
        }
        const { scope, file } = StageAgentReferenceSchema.parse(payload())
        expect(scope).toEqual({ projectId, draftId: expect.any(String) })
        scopes.push(scope.draftId)
        if (file.name === '损坏.pptx')
          return Response.json(
            { error: { code: 'BAD_REQUEST', message: '演示无法解析' } },
            { status: 400 },
          )
        const bytes = Buffer.from(file.content, 'base64')
        const id = crypto.randomUUID()
        const kind = file.name.endsWith('.png') ? 'image' : 'document'
        const summary: AgentReferenceSummary = {
          name: file.name,
          kind,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }
        if (kind === 'image') expect(file.content).toBe(png)
        else expect(bytes.equals(word)).toBe(true)
        materials.set(id, summary)
        return Response.json(
          {
            ...summary,
            id,
            expiresAt: Date.now() + 60_000,
            ...(kind === 'image'
              ? { image: `data:image/png;base64,${png}` }
              : { text: 'COBALT-SQUARE-407' }),
          },
          { status: 201 },
        )
      }
      case '/api/v1/agent/design': {
        const input = AgentDesignInputSchema.parse(payload())
        sent.push(input)
        const references = input.references?.ids.flatMap((id) => materials.get(id) ?? [])
        published.turns = [
          {
            id: crypto.randomUUID(),
            message: input.message,
            references,
            status: 'complete',
            publications: [],
          },
        ]
        return Response.json(published, { status: 202 })
      }
      case `/api/v1/agent/sessions/${published.id}`:
        return Response.json(published)
      default:
        return new Response(null, { status: 404 })
    }
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <LibraryShell onOpenArtifact={vi.fn()} />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: '新建设计' }))
  const dialog = within(await screen.findByRole('dialog', { name: '新建设计' }))
  const choose = async (field: string, option: string) => {
    fireEvent.click(dialog.getByRole('combobox', { name: field }))
    fireEvent.click(await screen.findByRole('option', { name: option }))
  }
  await choose('项目', '订单设计')
  await choose('发布 Agent', '本机 Codex')
  const brief = dialog.getByRole<HTMLTextAreaElement>('textbox', { name: '设计需求' })
  fireEvent.change(brief, { target: { value: '根据参考制作封面' } })
  const select = (files: File[]) =>
    fireEvent.change(dialog.getByLabelText('添加参考文件'), { target: { files } })
  select([new File([Uint8Array.from(Buffer.from(png, 'base64')).buffer], '色样.png')])
  fireEvent.click(await dialog.findByText('预览 色样.png'))
  expect(dialog.getByRole('img', { name: '图片预览：色样.png' }).getAttribute('src')).toBe(
    `data:image/png;base64,${png}`,
  )
  select([new File([Uint8Array.from(word).buffer], '简报.docx')])
  fireEvent.click(await dialog.findByText('预览 简报.docx'))
  expect(dialog.getByText('COBALT-SQUARE-407').closest('details')?.open).toBe(true)
  select([new File([Uint8Array.from(word).buffer], '不要发.docx')])
  await dialog.findByText('预览 不要发.docx')
  fireEvent.click(await dialog.findByRole('button', { name: '移除 不要发.docx' }))
  await waitFor(() => expect(removed).toHaveLength(1))
  select([new File(['不是真实演示'], '损坏.pptx')])
  const send = dialog.getByRole<HTMLButtonElement>('button', { name: '发送' })
  await dialog.findByRole('alert')
  expect(send.disabled).toBe(true)
  expect(brief.value).toBe('根据参考制作封面')
  expect(sent).toHaveLength(0)
  fireEvent.click(dialog.getByRole('button', { name: '移除 损坏.pptx' }))
  await waitFor(() => expect(send.disabled).toBe(false))
  fireEvent.click(send)
  await dialog.findByText('色样.png · 简报.docx')
  expect(new Set(scopes).size).toBe(1)
  const ids = [...materials.keys()].filter((id) => !removed.includes(id))
  expect(sent).toEqual([
    { projectId, message: '根据参考制作封面', references: { draftId: scopes[0], ids } },
  ])
})
