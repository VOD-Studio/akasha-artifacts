import { fireEvent, render } from '@testing-library/react/pure'
import { beforeAll, expect, it } from 'vitest'
import { builtinEnvironments } from 'vitest/environments'
import { createMemoryContainer } from '../../../packages/server/src/app/create-memory-container'
import { buttons } from '../../../packages/server/test/design-systems/brand'
import { compileReactArtifact } from '../src/runtime/compiler'

let published: { source: string; systemId: string }

// esbuild 的输入须属于 Node 的字节类型；先发布再安装 DOM，避免跨 realm 误判。
beforeAll(async () => {
  const { service } = createMemoryContainer()
  const draft = buttons('#1458ab')
  const review = await service.designSystems.preview('original', { draft, buildApproved: true })
  const system = await service.designSystems.publish(
    'original',
    {
      draft,
      buildApproved: true,
      reviewToken: review.reviewToken,
      confirmedRemovals: [],
      slug: 'controls',
      title: 'Original controls',
    },
    'human:local',
  )
  const board = await service.designSystems.generate(
    'original',
    {
      id: system.artifact.publicId,
      version: 1,
      slug: 'confirm-order',
      title: 'Confirm order',
      component: { path: 'src/Button.tsx', exportName: 'ConfirmButton' },
    },
    'human:local',
  )
  published = { source: board.version.source, systemId: system.artifact.publicId }
  const dom = await builtinEnvironments.jsdom.setup(globalThis, {})
  return () => dom.teardown(globalThis)
})

it('runs the published button and its selected stylesheet in the sandbox renderer', async () => {
  const Board = await compileReactArtifact(published.source)
  const view = render(<Board />)
  try {
    const button = view.getByRole('button', { name: 'Confirm order' })
    expect(getComputedStyle(button).backgroundColor).toBe('rgb(20, 88, 171)')
    expect(button.closest('main')?.dataset.akSystem).toBe(published.systemId)
    expect(button.closest('[data-ak-component]')?.getAttribute('data-ak-component')).toBe(
      'src/Button.tsx#ConfirmButton',
    )
    fireEvent.click(button)
    expect(button.textContent).toBe('Sent from original')
    expect(view.queryByText('Private badge implementation')).toBeNull()
  } finally {
    view.unmount()
  }
})
