import { expect, it } from 'vitest'
import type { CanvasBoard } from '../src/entities/artifact'
import { type CanvasBounds, DEFAULT_CAMERA } from '../src/widgets/ArtifactWorkspace/canvas-camera'
import { indexViewportBoards, planViewport } from '../src/widgets/ArtifactWorkspace/canvas-viewport'

const viewport = { width: 1440, height: 900 }
const board = (id: string): CanvasBoard => ({
  id,
  title: `画板 ${id}`,
  width: 330,
  height: 180,
  scoped: true,
  type: 'html',
})

it('重叠密集区只启动 24 块近景画板，退回鸟瞰时一块都不启动', () => {
  const boards = Array.from({ length: 32 }, (_, index) => board(`board-${index}`))
  const bounds = new Map(boards.map((item) => [item.id, { ...item, x: 40, y: 60 }]))
  const index = indexViewportBoards(boards, bounds)
  const selected = 'board-30'
  const close = planViewport(index, DEFAULT_CAMERA, viewport, selected, null)
  expect(close.boards).toEqual(boards)
  expect(close.detail).toEqual([selected, ...boards.slice(0, 23).map(({ id }) => id)])
  const distant = planViewport(index, { ...DEFAULT_CAMERA, scale: 0.1 }, viewport, selected, null)
  expect(distant.boards).toEqual(boards)
  expect(distant.detail).toEqual([])
})

it('平移和拖拽按新的包围盒安排正文，屏外的键盘焦点保留但不继续加载', () => {
  const boards = ['first', 'later', 'offscreen'].map(board)
  const bounds = new Map<string, CanvasBounds>([
    ['first', { x: -1_050, y: 100, width: 330, height: 180 }],
    ['later', { x: 400, y: 100, width: 330, height: 180 }],
    ['offscreen', { x: 30_000, y: 100, width: 330, height: 180 }],
  ])
  const index = indexViewportBoards(boards, bounds)
  const moved = new Map([['later', { x: 8_000, y: 100, width: 330, height: 180 }]])
  const plan = planViewport(index, { ...DEFAULT_CAMERA, x: 1_200 }, viewport, null, 'later', moved)
  expect(plan.boards).toEqual([boards[0], boards[1]])
  expect(plan.detail).toEqual(['first'])
})

it('从近邻复用已经进入过视口的帧，但不把近邻正文加入请求队列', () => {
  const boards = ['past', 'now', 'unvisited'].map(board)
  const index = indexViewportBoards(
    boards,
    new Map(boards.map((item, order) => [item.id, { ...item, x: order * 900, y: 40 }])),
  )
  const zoomed = { ...DEFAULT_CAMERA, x: -500 }
  const viewport = { width: 800, height: 400 }
  const previous = new Set(['past'])
  const plan = planViewport(index, zoomed, viewport, 'now', null, undefined, previous)
  expect(plan.detail).toEqual(['now'])
  expect([...plan.runtime]).toEqual(['now', 'past'])
  const birdseye = planViewport(
    index,
    { ...zoomed, scale: 0.2 },
    viewport,
    'now',
    null,
    undefined,
    plan.runtime,
  )
  expect([...birdseye.runtime]).toEqual([])
})
