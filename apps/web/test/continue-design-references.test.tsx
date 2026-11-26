// @vitest-environment jsdom
import { createHash } from 'node:crypto'
import {
  type AgentConversation,
  type AgentMessageInput,
  AgentMessageInputSchema,
  type AgentReferencePreview,
  StageAgentReferenceSchema,
} from '@akasha/protocol'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { strToU8, zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { detail, openWorkspace } from './workspace-shell-fixture'

const image =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwmnkGAAKYAZgAOdgfAAAAAElFTkSuQmCC'
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pkg = 'http://schemas.openxmlformats.org/package/2006'
const pres = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const contentType = 'application/vnd.openxmlformats-officedocument.presentationml'
const pptx = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${contentType}.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="${contentType}.slide+xml"/></Types>`,
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${pkg}/relationships"><Relationship Id="r1" Type="${rel}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  ),
  'ppt/presentation.xml': strToU8(
    `<p:presentation xmlns:p="${pres}" xmlns:r="${rel}"><p:sldIdLst><p:sldId id="256" r:id="r2"/></p:sldIdLst></p:presentation>`,
  ),
  'ppt/_rels/presentation.xml.rels': strToU8(
    `<Relationships xmlns="${pkg}/relationships"><Relationship Id="r2" Type="${rel}/slide" Target="slides/slide1.xml"/></Relationships>`,
  ),
  'ppt/slides/slide1.xml': strToU8(
    `<p:sld xmlns:p="${pres}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>AMBER-RING-519</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  ),
})

afterEach(() => {
  cleanup()
  setLocale('zh-CN')
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('进行中会话只发送重新确认的材料，原轮次清单与固定版本链接保持不变', async () => {
  setLocale('en')
  const { publicId, projectId } = detail.artifact
  const session: AgentConversation = {
    id: crypto.randomUUID(),
    projectId,
    artifactId: publicId,
    harness: 'codex',
    turns: [
      {
        id: crypto.randomUUID(),
        message: 'First design',
        status: 'complete',
        references: [{ name: 'original.md', kind: 'design', bytes: 8, sha256: 'a'.repeat(64) }],
        publications: [{ artifactId: publicId, version: 1 }],
      },
    ],
  }
  const sent: AgentMessageInput[] = []
  const byId = new Map<string, AgentReferencePreview>()
  const path = `/api/v1/artifacts/${publicId}/agent-session`
  openWorkspace()
  const base = vi.mocked(fetch).getMockImplementation()
  if (!base) throw new Error('工作区没有已装配的数据端点')
  vi.mocked(fetch).mockImplementation(async (input, options) => {
    const url = new URL(String(input), window.location.origin).pathname
    if (url === '/api/v1/agent/references') {
      if (options?.method === 'DELETE') return new Response(null, { status: 204 })
      const { file, scope } = StageAgentReferenceSchema.parse(JSON.parse(String(options?.body)))
      expect(scope).toEqual({ projectId, sessionId: session.id, draftId: expect.any(String) })
      const bytes = Buffer.from(file.content, 'base64')
      const id = crypto.randomUUID()
      const isImage = file.name === 'cover.png'
      if (isImage) expect(file.content).toBe(image)
      else expect(bytes.equals(pptx)).toBe(true)
      const preview: AgentReferencePreview = {
        id,
        name: file.name,
        kind: isImage ? 'image' : 'slides',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        expiresAt: Date.now() + 60_000,
        ...(isImage ? { image: `data:image/png;base64,${image}` } : { text: 'AMBER-RING-519' }),
      }
      byId.set(id, preview)
      return Response.json(preview, { status: 201 })
    }
    if (url !== path) return base(input, options)
    if (options?.method !== 'POST') return Response.json({ session, availability: 'ready' })
    const message = AgentMessageInputSchema.parse(JSON.parse(String(options.body)))
    sent.push(message)
    if (sent.length === 1)
      return Response.json(
        { error: { code: 'RESOURCE_CONFLICT', message: '材料已失效' } },
        { status: 409 },
      )
    const references = message.references?.ids.map((id) => {
      const material = byId.get(id)
      if (!material) throw new Error('请求指向未预览的材料')
      const { name, kind, sha256, bytes } = material
      return { name, kind, sha256, bytes }
    })
    session.turns.push({
      id: crypto.randomUUID(),
      message: message.message,
      status: 'complete',
      references,
      publications: [{ artifactId: publicId, version: 2 }],
    })
    return Response.json(session, { status: 202 })
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Agent conversation' }))
  const pane = within(await screen.findByRole('complementary', { name: 'Agent conversation' }))
  const fileInput = await pane.findByLabelText('Add reference files')
  const first = pane.getByRole('link', { name: 'Published v1' })
  expect(first.getAttribute('href')).toBe(`/a/${publicId}/v/1`)
  const message = pane.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
  fireEvent.change(message, { target: { value: 'Update the title from the new presentation.' } })
  fireEvent.change(fileInput, {
    target: {
      files: [
        new File([Uint8Array.from(Buffer.from(image, 'base64')).buffer], 'cover.png'),
        new File([Uint8Array.from(pptx).buffer], 'revision.pptx'),
      ],
    },
  })
  fireEvent.click(await pane.findByText('Preview revision.pptx'))
  expect(pane.getByText('AMBER-RING-519').closest('details')?.open).toBe(true)
  const send = pane.getByRole<HTMLButtonElement>('button', { name: 'Send' })
  await waitFor(() => expect(send.disabled).toBe(false))
  fireEvent.click(send)
  fireEvent.click(await pane.findByRole('button', { name: 'Retry cover.png' }))
  fireEvent.click(pane.getByRole('button', { name: 'Retry revision.pptx' }))
  await waitFor(() => expect(send.disabled).toBe(false))
  expect(message.value).toBe('Update the title from the new presentation.')
  expect(sent).toHaveLength(1)
  fireEvent.click(send)
  const next = await pane.findByRole('link', { name: 'Published v2' })
  expect(next.getAttribute('href')).toBe(`/a/${publicId}/v/2`)
  expect(pane.getByRole('link', { name: 'Published v1' })).toBe(first)
  const log = within(pane.getByRole('log'))
  expect(log.getByText('original.md')).toBeDefined()
  expect(log.getByText('cover.png · revision.pptx')).toBeDefined()
  expect(sent[1]?.references?.ids).toHaveLength(2)
  expect(sent[1]?.references?.ids.map((id) => byId.get(id)?.name)).toEqual([
    'cover.png',
    'revision.pptx',
  ])
  expect(sent[1]?.references?.draftId).not.toBe(sent[0]?.references?.draftId)
  expect(sent[1]?.references?.ids.some((id) => sent[0]?.references?.ids.includes(id))).toBe(false)
  expect(message.value).toBe('')
  expect(
    within(pane.getByRole('list', { name: 'References for this turn' })).queryAllByRole('listitem'),
  ).toEqual([])
})
