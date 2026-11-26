// @vitest-environment jsdom
import type { AgentReferenceInput } from '@akasha/protocol'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceComposer } from '../src/features/agent-conversation/references/ReferenceComposer'
import { useReferenceDraft } from '../src/features/agent-conversation/references/useReferenceDraft'

function Composer({ project }: { project: string }) {
  const draft = useReferenceDraft(project)
  return <ReferenceComposer key={project} draft={draft} disabled={false} />
}

function checkoutFile(path: string, content: string) {
  const file = new File([content], path.slice(path.lastIndexOf('/') + 1))
  Object.defineProperty(file, 'webkitRelativePath', { value: `checkout/${path}` })
  return file
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('目录只列候选路径，明确加入之前不读内容；只上传勾选文件的名称和正文', async () => {
  const chosen = checkoutFile('design/themes.css', '.marker { color: #123; }')
  const other = checkoutFile('design/other.md', 'must stay local')
  const excluded = [
    checkoutFile('.git/config.json', 'hidden'),
    checkoutFile('node_modules/package/theme.css', 'dependency'),
    checkoutFile('config/credentials.json', 'secret'),
    checkoutFile('secrets/production.json', 'secret'),
    checkoutFile('design/icons.svg', 'unsupported'),
  ]
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const text = vi.spyOn(FileReader.prototype, 'readAsText')
  const requests: AgentReferenceInput[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input) !== '/api/v1/agent/references' || init?.method !== 'POST') {
      return new Response(null, { status: 204 })
    }
    const { file } = JSON.parse(String(init.body))
    requests.push(file)
    return Response.json({
      id: crypto.randomUUID(),
      name: file.name,
      kind: 'design',
      bytes: chosen.size,
      sha256: '0'.repeat(64),
      text: atob(file.content),
      expiresAt: Date.now() + 60_000,
    })
  })
  render(<Composer project="project" />)
  fireEvent.change(screen.getByLabelText('选择参考目录'), {
    target: { files: [chosen, other, ...excluded] },
  })
  const checkboxes = screen.getAllByRole('checkbox')
  expect(checkboxes).toHaveLength(2)
  for (const checkbox of checkboxes) expect(checkbox.getAttribute('aria-checked')).toBe('false')
  const staged = within(screen.getByRole('list', { name: '本轮参考材料' }))
  expect(staged.queryAllByRole('listitem')).toHaveLength(0)
  fireEvent.click(screen.getByRole('checkbox', { name: 'design/themes.css' }))
  expect(staged.queryAllByRole('listitem')).toHaveLength(0)
  expect(read).not.toHaveBeenCalled()
  expect(text).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '添加所选文件' }))
  fireEvent.click(await staged.findByText('预览 themes.css'))
  expect(staged.getByText('.marker { color: #123; }').closest('details')?.open).toBe(true)
  expect(requests).toEqual([{ name: 'themes.css', content: btoa('.marker { color: #123; }') }])
  expect(read.mock.calls).toEqual([[chosen]])
  expect(text).not.toHaveBeenCalled()
  expect(staged.queryByText(other.name)).toBeNull()
})

it('切换项目即清除上个目录的候选和勾选，不会触发读取', () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  const read = vi.spyOn(FileReader.prototype, 'readAsDataURL')
  const { rerender } = render(<Composer project="one" />)
  fireEvent.change(screen.getByLabelText('选择参考目录'), {
    target: { files: [checkoutFile('private/brief.md', 'local draft')] },
  })
  fireEvent.click(screen.getByRole('checkbox', { name: 'private/brief.md' }))
  rerender(<Composer project="two" />)
  expect(screen.queryByText('private/brief.md')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(read).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})
