// @vitest-environment jsdom
import { catalogReferenceHeader, designSystemReferenceHeader } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SystemSourceLink } from '../src/features/design-system'
import { GenerateArtboard } from '../src/features/design-system/ui/GenerateArtboard'

const id = 'DesignSystemFixture123'
const resultId = 'GeneratedFixtureBoard1'
const projectId = 'team'
const component = { path: 'ui/Button.tsx', exportName: 'BrandButton' }
const sourceVersion = 'a'.repeat(64)
const source = `${designSystemReferenceHeader({ id, version: 2, sourceVersion, components: [component] })}\nexport default function Brand() { return null }`
const now = '2026-11-26T00:00:00.000Z'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('从指定历史版本选择具名组件，发布新作品成功后才导航；来源链接仍固定到旧版', async () => {
  const requests: unknown[] = []
  const title = 'Checkout'
  const slug = 'design/checkout'
  let denied = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
    requests.push([String(input), JSON.parse(String(options?.body))])
    if (denied) return new Response(null, { status: 403 })
    return Response.json({
      artifact: {
        publicId: resultId,
        projectId,
        slug,
        title,
        type: 'react',
        visibility: 'private',
        headVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
      version: {
        artifactId: resultId,
        parentVersion: null,
        version: 1,
        author: 'human:local',
        title,
        source,
        createdAt: now,
      },
    })
  })
  const open = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GenerateArtboard
        id={id}
        version={2}
        projectId={projectId}
        components={[{ ...component, props: { children: 'Continue' } }]}
        onOpenArtifact={open}
      />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByRole('textbox', { name: '画板名称' }), { target: { value: title } })
  fireEvent.change(screen.getByRole('textbox', { name: '别名' }), { target: { value: slug } })
  fireEvent.click(screen.getByRole('combobox', { name: '组件' }))
  fireEvent.click(await screen.findByRole('option', { name: 'ui/Button.tsx#BrandButton' }))
  fireEvent.click(screen.getByRole('button', { name: '生成画板' }))
  await screen.findByRole('alert')
  expect(open).not.toHaveBeenCalled()
  expect(requests).toEqual([
    ['/api/v1/projects/team/design-systems/generate', { id, version: 2, slug, title, component }],
  ])
  denied = false
  fireEvent.click(screen.getByRole('button', { name: '生成画板' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith(resultId))
  render(<SystemSourceLink source={source} />)
  fireEvent.click(screen.getByText('设计系统 · v2'))
  expect(screen.getByRole('link', { name: `${id} · v2` }).getAttribute('href')).toBe(`/a/${id}/v/2`)
  expect(screen.getByText(sourceVersion)).toBeDefined()
})

it('目录生成的作品展示每个固定来源和组件，不把来源标识变成读取链接', () => {
  const refs = [
    { id, version: 2, sourceVersion, components: [component] },
    {
      id: resultId,
      version: 3,
      sourceVersion,
      components: [{ path: 'other/Brand.tsx', exportName: 'BrandButton' }],
    },
  ]
  render(
    <SystemSourceLink
      source={`${catalogReferenceHeader(refs)}\nexport default function Design() { return null }`}
    />,
  )
  fireEvent.click(screen.getByText('本次使用的固定来源'))
  for (const text of [
    `${id} · v2`,
    `${resultId} · v3`,
    'ui/Button.tsx#BrandButton',
    'other/Brand.tsx#BrandButton',
  ]) {
    expect(screen.getByText(text)).toBeDefined()
  }
  expect(screen.queryByRole('link')).toBeNull()
})
