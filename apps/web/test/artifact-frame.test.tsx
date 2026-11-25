// @vitest-environment jsdom
import { PROTOCOL_VERSION, type VersionSummary } from '@akasha/protocol'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createBoardTweakPreviewStore } from '../src/widgets/ArtifactWorkspace/model/board-tweak-previews'
import { ArtifactFrame } from '../src/widgets/ArtifactWorkspace/ui/ArtifactFrame'

const version: VersionSummary = {
  artifactId: 'CanvasFramePublicId00001',
  version: 1,
  parentVersion: null,
  author: 'agent:cli',
  title: '参数截图',
  createdAt: '2026-11-22T09:00:00.000Z',
}

function sandbox() {
  const frame = screen.getByTitle<HTMLIFrameElement>('画板内容：参数截图')
  const win = frame.contentWindow
  if (!win) throw new Error('测试画板未建立独立窗口')
  const nonce = new URLSearchParams(new URL(frame.src).hash.slice(1)).get('nonce')
  return {
    post: vi.spyOn(win, 'postMessage').mockImplementation(() => {}),
    receive(data: object) {
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'null',
          source: win,
          data: { ...data, v: PROTOCOL_VERSION, nonce },
        }),
      )
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('握手后才发送最新临时参数；总览只给默认参数安排截图，重置不会重新渲染', async () => {
  const tweakPreviews = createBoardTweakPreviewStore()
  const field = {
    id: 'duration',
    type: 'number',
    label: '时长',
    default: 2,
    min: 0,
    max: 8,
  } as const
  tweakPreviews.getState().set('cover', field, 4)
  const onReady = vi.fn<(id: string, capture?: (signal: AbortSignal) => Promise<Blob>) => void>()
  render(
    <ArtifactFrame
      artifact={{
        publicId: version.artifactId,
        type: 'artboard',
        title: version.title,
        slug: 'artboard/frame',
        projectId: 'project-canvas',
        visibility: 'private',
        headVersion: 1,
        createdAt: version.createdAt,
        updatedAt: version.createdAt,
      }}
      version={version}
      board={{
        id: 'cover',
        title: version.title,
        type: 'html',
        scoped: true,
        source: '<h1>参数截图</h1>',
        width: 320,
        height: 180,
        appearance: { background: '#dddddd' },
        tweaks: [field],
      }}
      state={{ artifactId: version.artifactId, seq: 0, snapshot: {}, updatedAt: version.createdAt }}
      tweakPreviews={tweakPreviews}
      useTweakPreview
      sandboxOrigin="http://127.0.0.1:24331"
      notifyAgent
      pins={[]}
      onFocusPin={() => {}}
      purpose={{ type: 'overview', interactive: false, animate: false }}
      onReady={onReady}
      onCapabilities={() => {}}
      watchLayers={false}
      onLayers={() => {}}
      onElementTarget={() => {}}
      onVisualSelect={() => {}}
    />,
  )
  const frame = sandbox()
  act(() => tweakPreviews.getState().set('cover', field, 5))
  expect(frame.post).not.toHaveBeenCalled()
  frame.receive({ type: 'ready' })
  const commands = () => frame.post.mock.calls.map(([message]) => message)
  expect(commands()).toEqual([
    expect.objectContaining({
      type: 'render',
      renderId: 1,
      overviewAnimation: false,
      boardAppearance: { background: '#dddddd' },
      boardTweaks: { duration: 2 },
    }),
    expect.objectContaining({ type: 'pins.track' }),
    expect.objectContaining({ type: 'board.tweaks.preview', values: { duration: 5 } }),
  ])
  const rendered = { type: 'rendered', version: 1, renderId: 1 }
  frame.receive(rendered)
  expect(onReady).toHaveBeenNthCalledWith(1, 'cover')

  act(() => tweakPreviews.getState().reset('cover'))
  expect(commands().at(-1)).toMatchObject({ type: 'board.tweaks.preview', values: { duration: 2 } })
  expect(commands().filter((message) => message.type === 'render')).toHaveLength(1)
  expect(onReady).toHaveBeenCalledTimes(1)
  frame.receive(rendered)
  const capture = onReady.mock.lastCall?.[1]
  if (!capture) throw new Error('默认参数提交后未安排截图')
  const signal = new AbortController().signal
  const rejected = expect(capture(signal)).rejects.toThrow('画板正在预览临时参数')
  expect(commands().at(-1)).toMatchObject({ type: 'capture.png', requestId: '1', version: 1 })
  act(() => tweakPreviews.getState().set('cover', field, 6))
  await rejected
  expect(commands().slice(-2)).toEqual([
    expect.objectContaining({ type: 'capture.cancel', requestId: '1' }),
    expect.objectContaining({ type: 'board.tweaks.preview', values: { duration: 6 } }),
  ])
  await expect(capture(signal)).rejects.toThrow('画板正在预览临时参数')
})
