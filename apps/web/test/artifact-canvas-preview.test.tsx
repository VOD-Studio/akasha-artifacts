// @vitest-environment jsdom
import type { Feedback } from '@akasha/protocol'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  artifact,
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

it('展开的画板报错时，仍用作品原始链接向 Agent 投递', async () => {
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}))
  const base = detailFor(1, '<h1>预约首页</h1>')
  showWorkspace({ ...base, artifact: { ...base.artifact, type: 'html' } })
  fireEvent.click(screen.getByRole('button', { name: '展开画板：茶席预约' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  const frame = within(focus).getByTitle<HTMLIFrameElement>('画板内容：茶席预约')
  const sandboxFrame = sandbox(frame)
  sandboxFrame.receive({ type: 'ready' })
  sandboxFrame.receive({ type: 'error', phase: 'runtime', message: '焦点画板报错' })
  fireEvent.click(within(focus).getByRole('button', { name: '交给 Agent 修复' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/artifacts/${artifact.publicId}/feedback`),
      expect.objectContaining({ method: 'POST' }),
    ),
  )
})

it('在同一画布页面比较独立视口的宽屏和手机画板', () => {
  const pin: Feedback = {
    id: 'mobile-pin',
    artifactId: artifact.publicId,
    version: 1,
    roundId: null,
    groupId: null,
    kind: 'comment',
    element: {
      boardId: 'mobile',
      blockId: 'mobile-details',
      rect: { x: 10, y: 12, width: 90, height: 30 },
    },
    body: '确认手机字号',
    author: 'human:local',
    draft: false,
    status: 'pending',
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  }
  showWorkspace(detailFor(), [pin])
  const desktop = screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页')
  const mobile = screen.getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect([desktop.width, desktop.height]).toEqual(['1440', '900'])
  expect([mobile.width, mobile.height]).toEqual(['390', '844'])
  expect(desktop.contentWindow).not.toBe(mobile.contentWindow)
  expect(screen.queryByTitle('画板内容：预约完成')).toBeNull()

  const desktopSandbox = sandbox(desktop)
  const mobileSandbox = sandbox(mobile)
  expect(desktopSandbox.nonce).not.toBe(mobileSandbox.nonce)
  desktopSandbox.receive({ type: 'ready' })
  mobileSandbox.receive({ type: 'ready' })
  expect(desktopSandbox.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'render', boardId: 'desktop', source: '<h1>桌面预约</h1>' }),
    '*',
  )
  expect(mobileSandbox.post).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'render',
      boardId: 'mobile',
      source: '<h1 data-ak-block="mobile-details">手机预约</h1>',
    }),
    '*',
  )
  expect(mobile.parentElement?.contains(screen.getByTitle('确认手机字号'))).toBe(true)
  expect(desktopSandbox.post).not.toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'pins.track',
      pins: expect.arrayContaining([expect.objectContaining({ id: pin.id })]),
    }),
    '*',
  )

  mobileSandbox.receive({ type: 'error', phase: 'runtime', message: '手机画板渲染失败' })
  expect(mobile.parentElement?.contains(screen.getByText('手机画板渲染失败'))).toBe(true)
  expect(desktop.parentElement?.querySelector('[role="alert"]')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: '展开画板：手机首页' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  expect(within(focus).queryByTitle('确认手机字号')).toBeNull()
  fireEvent.click(within(focus).getByRole('button', { name: '返回总览' }))
  expect(screen.getByTitle('确认手机字号')).toBeTruthy()
})

it('展开画板按固有视口渲染，退出恢复总览的倍率、选板和键盘焦点', () => {
  showWorkspace()
  const canvas = screen.getByRole('region', { name: '画布' })
  const title = within(canvas).getByRole('button', { name: '手机首页' })
  fireEvent.click(title)
  fireEvent.click(screen.getByRole('button', { name: '放大' }))
  const overviewZoom = screen.getByLabelText('画布缩放比例').textContent
  const launch = within(canvas).getByRole('button', { name: '展开画板：手机首页' })
  fireEvent.click(launch)

  const focus = screen.getByRole('region', { name: '画板查看' })
  expect(screen.queryByRole('region', { name: '画布' })).toBeNull()
  const frame = within(focus).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect([frame.width, frame.height, frame.getAttribute('sandbox')]).toEqual([
    '390',
    '844',
    'allow-scripts',
  ])
  expect(frame.hasAttribute('inert')).toBe(true)
  fireEvent.click(within(focus).getByRole('button', { name: '填充宽度' }))
  expect(within(focus).getByRole('button', { name: '填充宽度' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  fireEvent.click(within(focus).getByRole('button', { name: '实际大小' }))
  expect(within(focus).getByLabelText('画板缩放比例').textContent).toBe('100%')

  fireEvent.keyDown(within(focus).getByRole('button', { name: '返回总览' }), { key: 'Escape' })
  expect(screen.queryByRole('region', { name: '画板查看' })).toBeNull()
  expect(title.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByLabelText('画布缩放比例').textContent).toBe(overviewZoom)
  expect(document.activeElement).toBe(launch)
})

it('显式播放原型才能交互和跨页，退出后返回原来的画板查看状态', () => {
  const source = JSON.stringify({
    ...design,
    showFlows: false,
    flows: [{ from: 'mobile', to: 'success', label: '确认预约' }],
    boards: design.boards.map((board) =>
      board.id === 'mobile'
        ? { ...board, html: '<button data-ak-next="success">确认预约</button>' }
        : board,
    ),
  })
  showWorkspace(detailFor(1, source))
  const overview = screen.getByRole('region', { name: '画布' })
  const mobile = within(overview).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  const mobileSandbox = sandbox(mobile)
  mobileSandbox.receive({ type: 'ready' })
  mobileSandbox.receive({ type: 'rendered', version: 1, playable: false })
  expect(within(overview).queryByRole('button', { name: '播放原型：手机首页' })).toBeNull()
  mobileSandbox.receive({ type: 'prototype.availability', version: 2, playable: true })
  expect(within(overview).queryByRole('button', { name: '播放原型：手机首页' })).toBeNull()
  mobileSandbox.receive({ type: 'prototype.availability', version: 1, playable: true })
  expect(mobile.hasAttribute('inert')).toBe(true)
  expect(within(overview).queryByRole('button', { name: '播放原型：宽屏首页' })).toBeNull()

  fireEvent.click(within(overview).getByRole('button', { name: '展开画板：手机首页' }))
  const focus = screen.getByRole('region', { name: '画板查看' })
  fireEvent.click(within(focus).getByRole('button', { name: '实际大小' }))
  const play = within(focus).getByRole('button', { name: '播放原型：手机首页' })
  fireEvent.click(play)
  const playback = screen.getByRole('region', { name: '交互预览' })
  const running = within(playback).getByTitle<HTMLIFrameElement>('画板内容：手机首页')
  expect(running.hasAttribute('inert')).toBe(false)
  expect(running.getAttribute('sandbox')).toBe('allow-scripts')
  expect(running.contentWindow).not.toBe(mobile.contentWindow)

  const player = sandbox(running)
  player.receive({ type: 'ready' })
  expect(player.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'render', playback: true, version: 1, boardId: 'mobile' }),
    '*',
  )
  player.receive({ type: 'prototype.navigate', version: 1, target: 'desktop' })
  player.receive({ type: 'prototype.navigate', version: 2, target: 'success' })
  expect(within(playback).queryByTitle('画板内容：预约完成')).toBeNull()
  player.receive({ type: 'prototype.navigate', version: 1, target: 'success' })
  const nextPlayback = screen.getByRole('region', { name: '交互预览' })
  const complete = within(nextPlayback).getByTitle<HTMLIFrameElement>('画板内容：预约完成')
  expect(complete.contentWindow).not.toBe(running.contentWindow)
  const completeSandbox = sandbox(complete)
  completeSandbox.receive({ type: 'ready' })
  completeSandbox.receive({ type: 'prototype.exit', version: 1 })
  expect(screen.queryByRole('region', { name: '交互预览' })).toBeNull()
  expect(screen.getByRole('region', { name: '画板查看' })).toBe(focus)
  expect(within(focus).getByLabelText('画板缩放比例').textContent).toBe('100%')
  expect(document.activeElement).toBe(play)
})

it('从播放菜单展开静态画板，返回后不替换原选区且还原触发焦点', () => {
  stubResizeObserver()
  const source = JSON.stringify({
    ...design,
    boards: design.boards.map((board) => ({
      ...board,
      presentation:
        board.id === 'mobile' ? { interactive: true } : { animation: false, interactive: false },
    })),
  })
  showWorkspace(detailFor(1, source))
  const canvas = screen.getByRole('region', { name: '画布' })
  const selected = within(canvas).getByRole('button', { name: '手机首页' })
  fireEvent.click(selected)
  const trigger = screen.getByRole('button', { name: '播放' })
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const staticBoards = screen.getByRole('group', { name: '静态画板' })
  expect(
    within(screen.getByRole('group', { name: '可交互原型' })).getByRole('menuitem', {
      name: '播放原型：手机首页',
    }),
  ).toBeTruthy()
  fireEvent.click(within(staticBoards).getByRole('menuitem', { name: '展开画板：宽屏首页' }))

  const focus = screen.getByRole('region', { name: '画板查看' })
  expect(within(focus).getByTitle('画板内容：宽屏首页').hasAttribute('inert')).toBe(true)
  const back = within(focus).getByRole('button', { name: '返回总览' })
  fireEvent.keyDown(back, { key: 'Escape' })
  expect(selected.getAttribute('aria-pressed')).toBe('true')
  expect(document.activeElement).toBe(trigger)
})

it('页面隐藏时暂停已运行画板，返回时不重建帧而恢复动画', () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const source = JSON.stringify({
    boards: [
      {
        id: 'motion',
        title: '动效封面',
        presentation: { animation: true },
        html: '<h1>动效</h1>',
      },
    ],
  })
  showWorkspace(detailFor(1, source))
  const frame = screen.getByTitle<HTMLIFrameElement>('画板内容：动效封面')
  const runtime = sandbox(frame)
  runtime.receive({ type: 'ready' })
  expect(runtime.post).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'render', overviewAnimation: true }),
    '*',
  )

  hidden.mockReturnValue(true)
  fireEvent(document, new Event('visibilitychange'))
  expect(runtime.post).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'animation.set', animate: false }),
    '*',
  )
  hidden.mockReturnValue(false)
  fireEvent(document, new Event('visibilitychange'))
  expect(runtime.post).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'animation.set', animate: true }),
    '*',
  )
  expect(screen.getByTitle('画板内容：动效封面')).toBe(frame)
})

it('大幅缩小画布再放大时不卸载已加载的画板，极小倍率下隐藏未选中板头避免标题重叠', () => {
  showWorkspace()
  const viewport = screen.getByRole('region', { name: '画布' })
  const desktopFrame = screen.getByTitle<HTMLIFrameElement>('画板内容：宽屏首页')
  const desktopHeader = screen
    .getByRole('button', { name: '宽屏首页' })
    .closest<HTMLElement>('.artifact-canvas-board-header')
  expect(desktopHeader?.dataset.compact).toBeUndefined()

  for (let i = 0; i < 18; i += 1) {
    fireEvent.wheel(viewport, { deltaY: 300, ctrlKey: true, clientX: 500, clientY: 300 })
  }
  expect(screen.getByTitle('画板内容：宽屏首页')).toBe(desktopFrame)
  expect(desktopHeader?.dataset.compact).toBe('true')
  expect(desktopHeader?.dataset.hideActions).toBe('true')
  expect(Number(desktopHeader?.style.getPropertyValue('--board-header-scale'))).toBeLessThan(1)

  for (let i = 0; i < 18; i += 1) {
    fireEvent.wheel(viewport, { deltaY: -300, ctrlKey: true, clientX: 500, clientY: 300 })
  }
  expect(screen.getByTitle('画板内容：宽屏首页')).toBe(desktopFrame)
  expect(desktopHeader?.dataset.compact).toBeUndefined()
  expect(desktopHeader?.dataset.hideActions).toBeUndefined()
})

