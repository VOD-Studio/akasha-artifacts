// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { layerSelector, readCanvasLayers } from '../src/inspector/layers'

it('重复节点仍能分别定位，动态或重复源码位置不会冒充可编辑图层', () => {
  const root = document.createElement('section')
  root.innerHTML = `
    <div data-ak-renderer="html">
      <main data-ak-loc="1:1">
        <button id="dup" data-ak-loc="2:3">第一项</button>
        <button id="dup" data-ak-loc="2:3">第二项</button>
        <div data-ak-dynamic="true"><h2 data-ak-loc="3:5">计算值</h2></div>
        <span data-ak-loc="4:3">可见项</span><span hidden data-ak-loc="4:3">隐藏副本</span>
        <p hidden>不可见内容</p>
      </main>
    </div>`
  const { layers } = readCanvasLayers(root)
  expect(layers.some((entry) => entry.label === '不可见内容' || entry.tag === 'p')).toBe(false)
  const parent = layers.find((entry) => entry.tag === 'main')
  expect(parent).toMatchObject({ sourceLoc: '1:1' })
  const first = layers.find((entry) => entry.label === '第一项')
  const second = layers.find((entry) => entry.label === '第二项')
  const dynamic = layers.find((entry) => entry.label === '计算值')
  expect(first?.parentId).toBe(parent?.id)
  expect(first?.id).not.toBe(second?.id)
  expect([first?.sourceLoc, second?.sourceLoc, dynamic?.sourceLoc]).toEqual([
    undefined,
    undefined,
    undefined,
  ])
  const target = root.querySelectorAll('button')[1]
  if (!target) throw new Error('缺少重复按钮夹具')
  expect(layerSelector(target, root)).toBe(second?.selector)
  expect(root.querySelector(String(second?.selector))).toBe(target)
  expect(layers.find((entry) => entry.label === '可见项')?.sourceLoc).toBeUndefined()
  target.parentElement?.prepend(target)
  const moved = readCanvasLayers(root).layers.find((entry) => entry.label === '第二项')
  expect(moved?.id).toBe(second?.id)
  expect(moved?.selector).not.toBe(second?.selector)
})
