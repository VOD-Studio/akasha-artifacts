// @vitest-environment jsdom
import type { CanvasLayerStyles } from '@akasha/protocol'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { BoardLayerStyles } from '../src/widgets/ArtifactWorkspace/inspector/BoardLayerStyles'

afterEach(cleanup)

it('切换图层后等待匹配的快照，区分未读全与确实为空', () => {
  const styles: CanvasLayerStyles = {
    layerId: 'a',
    declarations: [
      { property: 'color', value: 'red', source: '.note', important: true },
      { property: 'font-size', value: '16px', source: 'style', inheritedFrom: 'main#sheet' },
    ],
    truncated: false,
  }
  const view = render(<BoardLayerStyles layerId="a" styles={styles} />)
  expect(screen.getByRole('heading', { name: '本层声明' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: '继承自 main#sheet' })).toBeTruthy()
  expect(screen.getByText('.note')).toBeTruthy()
  expect(screen.getByText('color: red !important;')).toBeTruthy()
  expect(screen.getByText('style')).toBeTruthy()
  expect(screen.getByText('font-size: 16px;')).toBeTruthy()
  view.rerender(<BoardLayerStyles layerId="b" styles={styles} />)
  expect(screen.queryByText('.note')).toBeNull()
  expect(screen.getByRole('status')).toBeTruthy()
  expect(screen.queryByText('没有可归属的样式声明')).toBeNull()
  const empty = { layerId: 'b', declarations: [], truncated: true }
  view.rerender(<BoardLayerStyles layerId="b" styles={empty} />)
  expect(screen.getByText('样式声明不完整')).toBeTruthy()
  expect(screen.queryByText('没有可归属的样式声明')).toBeNull()
  view.rerender(<BoardLayerStyles layerId="b" styles={{ ...empty, truncated: false }} />)
  expect(screen.getByText('没有可归属的样式声明')).toBeTruthy()
})
