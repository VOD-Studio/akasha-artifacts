import type { CanvasLayer, DesignLayer } from '@akasha/protocol'
import { describe, expect, it } from 'vitest'
import type { CanvasBoard, CanvasBounds } from '@/entities/artifact'
import { editCanvasBoards } from '../src/widgets/ArtifactWorkspace/lib/canvas-board-source'
import {
  materializePastedBoards,
  materializePastedLayers,
  snapshotBoardsForClipboard,
} from '../src/widgets/ArtifactWorkspace/lib/canvas-clipboard'
import {
  boardsIntersectingRect,
  firstChildLayer,
  firstRootLayer,
  nextSiblingLayer,
  parentLayer,
  resolveLayerOwnerBoard,
  updateTailwindTextClasses,
} from '../src/widgets/ArtifactWorkspace/lib/canvas-layer-navigation'
import {
  evaluateColorContrast,
  parseCssColor,
} from '../src/widgets/ArtifactWorkspace/lib/color-contrast'

describe('color-contrast', () => {
  it('按 WCAG 2.1 解析十六进制与 rgb/rgba 并评定对比度等级', () => {
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseCssColor('rgba(32, 39, 51, 0.5)')).toEqual({ r: 32, g: 39, b: 51, a: 0.5 })
    expect(evaluateColorContrast('#202733', '#ffffff')).toMatchObject({
      level: 'AAA',
      formatted: '15.0:1',
    })
    expect(evaluateColorContrast('#9ca3af', '#ffffff')).toMatchObject({ level: 'fail' })
    expect(
      evaluateColorContrast('#767676', '#ffffff', { fontSize: 16, fontWeight: 400 }),
    ).toMatchObject({ level: 'AA' })
    expect(
      evaluateColorContrast('#949494', '#ffffff', { fontSize: 24, fontWeight: 400 }),
    ).toMatchObject({ level: 'AA-large' })
  })
})

describe('canvas-layer-navigation', () => {
  const layers: CanvasLayer[] = [
    { id: 'root-1', tag: 'section', selector: 'section:nth-of-type(1)', width: 300, height: 200 },
    {
      id: 'child-1',
      parentId: 'root-1',
      tag: 'h1',
      selector: 'section > h1',
      width: 200,
      height: 40,
    },
    {
      id: 'child-2',
      parentId: 'root-1',
      tag: 'p',
      selector: 'section > p',
      width: 200,
      height: 24,
    },
    { id: 'root-2', tag: 'footer', selector: 'footer:nth-of-type(1)', width: 300, height: 60 },
  ]

  it('支持 Return 进入、Tab 遍历同级、Shift+Return 退层', () => {
    expect(firstRootLayer(layers)?.id).toBe('root-1')
    expect(firstChildLayer(layers, 'root-1')?.id).toBe('child-1')
    expect(firstChildLayer(layers, 'child-1')).toBeUndefined()
    expect(nextSiblingLayer(layers, 'child-1', 1)?.id).toBe('child-2')
    expect(nextSiblingLayer(layers, 'child-2', 1)?.id).toBe('child-1')
    expect(nextSiblingLayer(layers, 'root-1', -1)?.id).toBe('root-2')
    expect(parentLayer(layers, 'child-2')?.id).toBe('root-1')
    expect(parentLayer(layers, 'root-1')).toBeUndefined()
  })

  it('框选展开同组画板，跨板边界绘制按起笔与最大交集确定归属，纯空白拒绝游离', () => {
    const boards: CanvasBoard[] = [
      {
        id: 'a',
        title: 'A',
        width: 400,
        height: 300,
        type: 'html',
        scoped: true,
        layoutGroup: 'g1',
      },
      {
        id: 'b',
        title: 'B',
        width: 400,
        height: 300,
        type: 'html',
        scoped: true,
        layoutGroup: 'g1',
      },
      { id: 'c', title: 'C', width: 400, height: 300, type: 'html', scoped: true },
    ]
    const bounds = new Map<string, CanvasBounds>([
      ['a', { x: 0, y: 0, width: 400, height: 300 }],
      ['b', { x: 500, y: 0, width: 400, height: 300 }],
      ['c', { x: 1000, y: 0, width: 400, height: 300 }],
    ])
    expect(
      boardsIntersectingRect(boards, bounds, { x: 20, y: 20, width: 100, height: 100 }),
    ).toEqual(['a', 'b'])
    expect(
      resolveLayerOwnerBoard(boards, bounds, { x: 360, y: 40, width: 120, height: 80 }, 'a'),
    ).toEqual({
      board: boards[0],
      localBounds: { x: 360, y: 40, width: 120, height: 80 },
    })
    expect(
      resolveLayerOwnerBoard(boards, bounds, { x: 960, y: 40, width: 120, height: 80 }),
    ).toEqual({
      board: boards[2],
      localBounds: { x: -40, y: 40, width: 120, height: 80 },
    })
    expect(
      resolveLayerOwnerBoard(boards, bounds, { x: 420, y: 340, width: 60, height: 60 }),
    ).toBeNull()
  })

  it('更新静态元素的文字排版、对齐与颜色 Tailwind 类名而不破坏布局类', () => {
    const updated = updateTailwindTextClasses('p-4 text-sm font-normal text-left text-slate-700', {
      fontSize: 24,
      fontWeight: 'bold',
      textAlign: 'center',
      colorHex: '#1D4ED8',
    })
    expect(updated).toBe('p-4 text-2xl font-bold text-center text-[#1d4ed8]')
  })
})

describe('canvas-board-source & clipboard', () => {
  const sample = JSON.stringify({
    pages: [{ id: 'p1', title: '首页' }],
    boards: [
      {
        id: 'b1',
        title: '主画板',
        pageId: 'p1',
        position: { x: 0, y: 0 },
        viewport: { width: 400, height: 300 },
        html: '<h1>标题</h1>',
        designLayers: [
          { id: 't1', kind: 'text', x: 20, y: 20, width: 120, height: 40, text: '文案' },
          { id: 'r1', kind: 'rectangle', x: 160, y: 20, width: 80, height: 60, color: 'blue' },
        ] satisfies DesignLayer[],
      },
    ],
  })

  it('带位置范围创建画板、更新文字样式、翻转并粘贴重映射分组', () => {
    const created = editCanvasBoards(sample, 1, {
      kind: 'create',
      id: 'b2',
      title: '新画板',
      pageId: 'p1',
      bounds: { x: 520, y: 80, width: 390, height: 844 },
    })
    expect(JSON.parse(created.after).boards[1]).toMatchObject({
      id: 'b2',
      position: { x: 520, y: 80 },
      viewport: { width: 390, height: 844 },
    })

    const styled = editCanvasBoards(created.after, 2, {
      kind: 'layerStyle',
      boardId: 'b1',
      layerIds: ['t1'],
      patch: { color: '#1d4ed8', fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
    })
    expect(JSON.parse(styled.after).boards[0].designLayers[0]).toMatchObject({
      color: '#1d4ed8',
      fontSize: 24,
      fontWeight: 'bold',
      textAlign: 'center',
    })

    const flipped = editCanvasBoards(styled.after, 3, {
      kind: 'layerFlip',
      boardId: 'b1',
      layerIds: ['t1', 'r1'],
      axis: 'horizontal',
    })
    const flippedLayers = JSON.parse(flipped.after).boards[0].designLayers
    expect(flippedLayers[0]).toMatchObject({ flipX: true, x: 120 })
    expect(flippedLayers[1]).toMatchObject({ flipX: true, x: 20 })

    const reordered = editCanvasBoards(flipped.after, 4, {
      kind: 'layerReorder',
      boardId: 'b1',
      layerId: 't1',
      delta: 1,
    })
    expect(
      JSON.parse(reordered.after).boards[0].designLayers.map((l: DesignLayer) => l.id),
    ).toEqual(['r1', 't1'])

    let seq = 0
    const nextId = () => `copy-${++seq}`
    const pastedLayers = materializePastedLayers(
      {
        kind: 'layers',
        sourceBoardId: 'b1',
        layers: [
          { ...JSON.parse(reordered.after).boards[0].designLayers[0], layoutGroup: 'grp-a' },
        ],
        pasteCount: 0,
      },
      'b1',
      nextId,
    )
    expect(pastedLayers[0]).toMatchObject({ id: 'copy-2', layoutGroup: 'copy-1', x: 36, y: 36 })

    const clipBoards = snapshotBoardsForClipboard(
      created.after,
      2,
      'p1',
      ['b1'],
      new Map([['b1', { x: 0, y: 0, width: 400, height: 300 }]]),
    )
    expect(clipBoards).not.toBeNull()
    if (clipBoards) {
      const copies = materializePastedBoards(clipBoards, 'p1', nextId)
      const pasted = editCanvasBoards(created.after, 2, {
        kind: 'pasteBoards',
        pageId: 'p1',
        boards: copies,
      })
      expect(JSON.parse(pasted.after).boards).toHaveLength(3)
      expect(JSON.parse(pasted.after).boards[2].position).toEqual({ x: 48, y: 48 })
    }
  })
})
