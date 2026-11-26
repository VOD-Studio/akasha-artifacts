import { fireEvent, render } from '@testing-library/react/pure'
import { expect, it } from 'vitest'
import { builtinEnvironments } from 'vitest/environments'
import { previewDesignSystem } from '../../../packages/server/src/application/design-systems/review'
import { buttons } from '../../../packages/server/test/design-systems/brand'
import { compileReactArtifact } from '../src/runtime/compiler'

it('runs the selected button and its stylesheet in the sandbox renderer', async () => {
  const draft = buttons('#1458ab')
  const review = await previewDesignSystem({ draft, buildApproved: true })
  const dom = await builtinEnvironments.jsdom.setup(globalThis, {})
  try {
    const Board = await compileReactArtifact(review.previewSource)
    const view = render(<Board />)
    try {
      const button = view.getByRole('button', { name: 'Confirm order' })
      expect(getComputedStyle(button).backgroundColor).toBe('rgb(20, 88, 171)')
      expect(button.closest('[data-ak-component]')?.getAttribute('data-ak-component')).toBe(
        'src/Button.tsx#ConfirmButton',
      )
      fireEvent.click(button)
      expect(button.textContent).toBe('Sent from original')
    } finally {
      view.unmount()
    }
  } finally {
    await dom.teardown(globalThis)
  }
})
