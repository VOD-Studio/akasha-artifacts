import { composeCatalogBoard } from '@akasha/kit'
import { type DesignSystemDraft, readCatalogReferences } from '@akasha/protocol'
import { fireEvent, type RenderResult, render } from '@testing-library/react/pure'
import { expect, it } from 'vitest'
import { builtinEnvironments } from 'vitest/environments'
import { previewDesignSystem } from '../../../packages/server/src/application/design-systems/review'
import { brand, buttons } from '../../../packages/server/test/design-systems/brand'
import { compileReactArtifact } from '../src/runtime/compiler'

async function reviewed(draft: DesignSystemDraft) {
  return { draft, ...(await previewDesignSystem({ draft, buildApproved: true })) }
}

async function renderBoard(source: string, inspect: (view: RenderResult) => void) {
  const dom = await builtinEnvironments.jsdom.setup(globalThis, {})
  try {
    const Board = await compileReactArtifact(source)
    const view = render(<Board />)
    try {
      inspect(view)
    } finally {
      view.unmount()
    }
  } finally {
    await dom.teardown(globalThis)
  }
}

function systemRoots(container: HTMLElement) {
  return Array.from(container.querySelectorAll('*'), (node) => node.shadowRoot).filter(
    (root) => root !== null,
  )
}

it('renders two independently clickable reviewed exports with their own conflicting stylesheet', async () => {
  const entries = await Promise.all(
    ['#1458ab', '#b23116'].map(async (color, i) => {
      const draft = buttons(color)
      draft.files[0].content += '\n// Internal source notes'
      draft.files.push(...brand.files)
      return {
        id: `OriginalControls0${i}`,
        version: i + 1,
        snapshot: await reviewed(draft),
        index: 0,
      }
    }),
  )
  const { source, references } = composeCatalogBoard('Checkout options', entries)
  expect(source).not.toContain('Private badge implementation')
  expect(source).not.toContain('src/Badge.tsx')
  expect(source).not.toContain('www.figma.com')
  expect(source).not.toContain('Internal source notes')
  expect(readCatalogReferences(source)).toEqual(references)
  expect(references).toEqual(
    entries.map(({ id, version, snapshot }) => ({
      id,
      version,
      sourceVersion: snapshot.sourceVersion,
      components: [{ path: 'src/Button.tsx', exportName: 'ConfirmButton' }],
    })),
  )

  await renderBoard(source, (view) => {
    const roots = systemRoots(view.container)
    expect(roots).toHaveLength(2)
    const controls = roots.map((root, i) => {
      const button = root.querySelector('button')
      if (!button) throw new Error('缺少选定组件的按钮')
      expect(button.textContent).toBe('Confirm order')
      expect(root.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;/)
      // jsdom 不计算 Shadow DOM 层叠；用 CSSOM 核对各样式树内实际匹配按钮的规则。
      const buttonStyles = Array.from(root.querySelectorAll('style')).flatMap((style) => {
        const sheet = new window.CSSStyleSheet()
        sheet.insertRule(style.textContent ?? '', 0)
        const rule = sheet.cssRules[0]
        return rule instanceof window.CSSStyleRule && button.matches(rule.selectorText)
          ? [rule.style.getPropertyValue('background-color')]
          : []
      })
      expect(buttonStyles).toEqual([i === 0 ? '#1458ab' : '#b23116'])
      return button
    })
    expect(view.container.querySelector('style')).toBeNull()
    fireEvent.click(controls[0])
    expect(controls[0].textContent).toBe('Sent from original')
    expect(controls[1].textContent).toBe('Confirm order')
    fireEvent.click(controls[1])
    expect(controls[1].textContent).toBe('Sent from original')
  })
})

it('uses every reviewed export for a whole system and retains a brand-only selection', async () => {
  const [controls, identity] = await Promise.all([reviewed(buttons('#1458ab')), reviewed(brand)])
  const { source } = composeCatalogBoard('Brand and controls', [
    { id: 'OriginalControls01', version: 1, snapshot: controls, index: null },
    { id: 'TriangleIdentity01', version: 2, snapshot: identity, index: null },
  ])
  await renderBoard(source, (view) => {
    const [components, guidance] = systemRoots(view.container)
    expect(components.querySelector('strong')?.textContent).toBe('Private badge implementation')
    expect(components.querySelector('button')?.textContent).toBe('Confirm order')
    expect(guidance.querySelector('h1')?.textContent).toBe('Triangle Foundry')
    expect(guidance.textContent).toContain('Keep the wordmark on its own line.')
    expect(guidance.textContent).toContain('use the triangular mark at the start of the page')
  })
})

it('opens an independent board with the supplied title when no systems are selected', async () => {
  const { source, references } = composeCatalogBoard('A new direction', [])
  expect(references).toEqual([])
  expect(readCatalogReferences(source)).toEqual([])
  await renderBoard(source, (view) => {
    expect(view.getByRole('heading', { name: 'A new direction' })).toBeTruthy()
    expect(view.container.querySelector('[data-ak-system]')).toBeNull()
  })
})
