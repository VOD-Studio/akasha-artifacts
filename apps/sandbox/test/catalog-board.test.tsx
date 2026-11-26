import { composeCatalogBoard, reconcileCatalogCandidate } from '@akasha/kit'
import { type DesignSystemDraft, PROTOCOL_VERSION, readCatalogReferences } from '@akasha/protocol'
import { fireEvent, type RenderResult, render } from '@testing-library/react/pure'
import { expect, it } from 'vitest'
import { builtinEnvironments } from 'vitest/environments'
import { previewDesignSystem } from '../../../packages/server/src/application/design-systems/review'
import { brand, buttons } from '../../../packages/server/test/design-systems/brand'
import type { SandboxBridgeClient } from '../src/bridge/client'
import { buildElementRef, findElementByRef, SandboxInspector } from '../src/inspector'
import { readCanvasLayers } from '../src/inspector/layers'
import { hasPlayableControls } from '../src/prototype/binding'
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
    const root = view.container
    expect(hasPlayableControls(root)).toBe(true)
    const layers = readCanvasLayers(root).layers.filter((item) => item.tag === 'button')
    expect(layers.map(({ label }) => label)).toEqual(['Confirm order', 'Confirm order'])
    const refs = controls.map((button) => buildElementRef(button, root))
    expect(refs[0].selector).not.toBe(refs[1].selector)
    const sent: Parameters<SandboxBridgeClient['send']>[0][] = []
    const inspector = new SandboxInspector(
      () => root,
      { send: (message) => sent.push(message) },
      () => 1,
    )
    try {
      // jsdom 没有布局命中 API；只提供浏览器在 document/ShadowRoot 两层各自报告的元素。
      for (const [i, button] of controls.entries()) {
        Object.defineProperty(document, 'elementFromPoint', {
          configurable: true,
          value: () => roots[i].host,
        })
        Object.defineProperty(roots[i], 'elementFromPoint', {
          configurable: true,
          value: () => button,
        })
        expect(findElementByRef(root, refs[i])).toBe(button)
        inspector.inspectAt({
          v: PROTOCOL_VERSION,
          nonce: 'inspect',
          type: 'inspect.at',
          purpose: 'select',
          version: 1,
          requestId: 'pick',
          x: 2,
          y: 2,
        })
        expect(sent.at(-1)).toMatchObject({
          type: 'inspect.target',
          layer: { id: layers[i].id },
          element: { selector: refs[i].selector },
        })
        inspector.highlight({ selector: layers[i].selector }, undefined, {
          id: layers[i].id,
          version: 1,
        })
        expect(sent.at(-1)).toMatchObject({ type: 'inspect.select', layerId: layers[i].id })
      }
      inspector.trackPins(refs.map((element, i) => ({ id: String(i), element })))
      expect(sent.at(-1)).toMatchObject({
        type: 'pins.rects',
        rects: { '0': expect.any(Object), '1': expect.any(Object) },
      })
    } finally {
      inspector.dispose()
    }
    fireEvent.click(controls[0])
    expect(controls[0].textContent).toBe('Sent from original')
    expect(controls[1].textContent).toBe('Confirm order')
    fireEvent.click(controls[1])
    expect(controls[1].textContent).toBe('Sent from original')
    const other = roots[1].querySelector('main')
    if (!other) throw new Error('缺少第二个来源')
    const secondId = other.dataset.akSystem
    other.dataset.akSystem = entries[0].id
    other.dataset.akSystemVersion = String(entries[0].version)
    expect(findElementByRef(root, refs[0])).toBeNull()
    other.dataset.akSystem = secondId
    other.dataset.akSystemVersion = String(entries[1].version)
    roots[0].host.remove()
    expect(findElementByRef(root, refs[0])).toBeNull()
    expect(findElementByRef(root, refs[1])).toBe(controls[1])
  })
})

it('uses every reviewed export for a whole system and retains a brand-only selection', async () => {
  const [controls, identity] = await Promise.all([reviewed(buttons('#1458ab')), reviewed(brand)])
  const { source } = composeCatalogBoard('Brand and controls', [
    { id: 'OriginalControls01', version: 1, snapshot: controls, index: null },
    {
      id: 'TriangleIdentity01',
      version: 2,
      title: 'Team identity',
      snapshot: identity,
      index: null,
    },
  ])
  expect(source).not.toContain('Triangle Foundry')
  expect(source).not.toContain('triangle-foundry/ui')
  await renderBoard(source, (view) => {
    const [components, guidance] = systemRoots(view.container)
    expect(components.querySelector('strong')?.textContent).toBe('Private badge implementation')
    expect(components.querySelector('button')?.textContent).toBe('Confirm order')
    expect(guidance.querySelector('h1')?.textContent).toBe('Team identity')
    expect(guidance.textContent).toContain('Keep the wordmark on its own line.')
    expect(guidance.textContent).toContain('use the triangular mark at the start of the page')
  })
})

it('does not offer prototype playback for an actual brand-only fixed system', async () => {
  const { source } = composeCatalogBoard('Identity', [
    { id: 'TriangleIdentity01', version: 1, snapshot: await reviewed(brand), index: null },
  ])
  await renderBoard(source, (view) => {
    expect(systemRoots(view.container)[0].textContent).toContain('Keep the wordmark')
    expect(hasPlayableControls(view.container)).toBe(false)
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

it('restores the reviewed implementation and brand color without replacing authored instance copy', async () => {
  const id = 'OriginalControls01'
  const expected = composeCatalogBoard('Checkout', [
    { id, version: 2, snapshot: await reviewed(buttons('#1458ab')), index: 0 },
  ])
  const candidate = expected.source
    .replace('Sent from original', 'Wrong implementation')
    .replace('#1458ab', '#ff00aa')
    .replace('"color":"#123456"', '"color":"#abcdef"')
    .replace('"children":"Confirm order"', '"children": "Place order"')
    .replace('"Checkout"', '"My checkout"')
  const result = reconcileCatalogCandidate(expected, candidate)
  if (!result.ok) throw new Error(`${result.reason}:${result.line}`)
  expect(result.corrections).toEqual([
    {
      kind: 'component',
      id,
      version: 2,
      component: { path: 'src/Button.tsx', exportName: 'ConfirmButton' },
    },
    { kind: 'guidance', id, version: 2 },
  ])
  await renderBoard(result.source, (view) => {
    expect(view.getByRole('heading', { name: 'My checkout' })).toBeTruthy()
    const [root] = systemRoots(view.container)
    expect(root.querySelector('style')?.textContent).toContain('#1458ab')
    const main = root.querySelector('main')
    const button = root.querySelector('button')
    if (!main || !button) throw new Error('缺少修正后的系统或实例')
    expect(main.style.color).toBe('rgb(18, 52, 86)')
    expect(button.textContent).toBe('Place order')
    fireEvent.click(button)
    expect(button.textContent).toBe('Sent from original')
  })
})

it('reports the candidate line for unknown code, a changed reference, and an unreviewed instance key', async () => {
  const expected = composeCatalogBoard('Checkout', [
    {
      id: 'OriginalControls01',
      version: 1,
      snapshot: await reviewed(buttons('#1458ab')),
      index: 0,
    },
  ])
  const source = expected.source
  const lineOf = (text: string, marker: string) =>
    text.slice(0, text.indexOf(marker)).split('\n').length
  const extra = `${source}\nexport const custom = true`
  expect(reconcileCatalogCandidate(expected, extra)).toEqual({
    ok: false,
    reason: 'structure',
    line: lineOf(extra, 'export const custom'),
  })
  expect(
    reconcileCatalogCandidate(expected, source.replace('OriginalControls01', 'DifferentOwner01')),
  ).toEqual({
    ok: false,
    reason: 'reference',
    line: 1,
  })
  const instance = source.replace('"children":"Confirm order"', '"children":"Buy","children":"Pay"')
  expect(reconcileCatalogCandidate(expected, instance)).toEqual({
    ok: false,
    reason: 'instance',
    line: lineOf(instance, 'const model = '),
  })
})
