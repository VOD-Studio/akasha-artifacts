// @vitest-environment jsdom
import type { Feedback } from '@akasha/protocol'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ArtifactWorkspace } from '../src/widgets/ArtifactWorkspace'
import { patchHtmlElementGeometry } from '../src/widgets/ArtifactWorkspace/lib/html-element-geometry'
import {
  artifact,
  design,
  detailFor,
  sandbox,
  setupCanvasTest,
  showEditableWorkspace,
  showWorkspace,
  stubResizeObserver,
} from './canvas-test-fixture'

setupCanvasTest()

function sourceWithCardAndText() {
  return JSON.stringify({
    ...design,
    boards: design.boards.map((board) =>
      board.id === 'desktop'
        ? {
            ...board,
            designLayers: [
              {
                id: 'card',
                kind: 'rectangle',
                x: 80,
                y: 90,
                width: 160,
                height: 100,
                color: 'blue',
              },
              {
                id: 'heading',
                kind: 'text',
                x: 40,
                y: 30,
                width: 220,
                height: 44,
                text: '原始标题',
                color: '#202733',
              },
            ],
          }
        : board,
    ),
  })
}

it('批注工具进入画布模式后切换批注指针，点击落点命中元素并支持画板图钉与草稿隔离', async () => {
  stubResizeObserver()
  const submitted: Array<Record<string, unknown>> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init) => {
      if (String(input).includes('/feedback') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        submitted.push(body)
        return Response.json(
          {
            feedback: {
              id: `fb_${submitted.length}`,
              artifactId: artifact.publicId,
              version: 1,
              roundId: null,
              groupId: null,
              kind: body.kind,
              audience: body.audience,
              element: body.element,
              body: body.body,
              author: 'human:local',
              draft: false,
              status: 'pending',
              createdAt: '2026-11-26T00:00:00Z',
              updatedAt: '2026-11-26T00:00:00Z',
            },
          },
          { status: 201 },
        )
      }
      return Response.json({ selection: null })
    }),
  )

  showWorkspace(detailFor(1, sourceWithCardAndText()))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const canvas = screen.getByRole('region', { name: '画布' })
  const commentBtn = screen.getByRole('button', { name: '画布批注' })
  expect(canvas.dataset.tool).toBe('select')
  expect(commentBtn.getAttribute('aria-pressed')).toBe('false')

  // 点击批注工具：进入批注模式，切换批注指针并取消选择工具激活态。
  fireEvent.click(commentBtn)
  expect(canvas.dataset.tool).toBe('comment')
  expect(commentBtn.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: '选择' }).getAttribute('aria-pressed')).toBe('false')

  // 点击画板落点：立即显示待提交水滴图钉和锚点输入卡，同时向沙盒发起命中探测。
  const commentHit = screen.getByRole('button', { name: '在宽屏首页添加批注' })
  vi.spyOn(commentHit, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 720, 450))
  fireEvent.click(commentHit, { detail: 1, clientX: 200, clientY: 130 })

  expect(screen.getByTestId('pending-comment-pin')).toBeTruthy()
  const composer = screen.getByTestId('anchored-annotation-composer')
  expect(composer.textContent).toContain('宽屏首页')

  const inspectReq = frame.post.mock.calls.find(
    ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'select',
  )?.[0]
  expect(inspectReq).toMatchObject({ version: 1, x: 200, y: 160 })

  // 沙盒返回命中元素：输入卡无缝升级为「画板名 › 元素名」。
  frame.receive({
    type: 'inspect.target',
    purpose: 'select',
    requestId: inspectReq.requestId,
    version: 1,
    element: {
      blockId: 'design-layer:heading',
      selector: 'aside > div:nth-of-type(2)',
      rect: { x: 40, y: 30, width: 220, height: 44 },
      textPreview: '原始标题',
    },
    layer: {
      id: 'v1:heading',
      selector: 'aside > div:nth-of-type(2)',
      blockId: 'design-layer:heading',
    },
  })
  expect(composer.textContent).toContain('宽屏首页 › 原始标题')

  // 输入未发送草稿后改点另一张画板：不把旧元素草稿静默套到新落点。
  fireEvent.change(within(composer).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '针对宽屏标题的半句草稿' },
  })
  const mobileCommentHit = screen.getByRole('button', { name: '在手机首页添加批注' })
  vi.spyOn(mobileCommentHit, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(900, 50, 195, 422),
  )
  fireEvent.click(mobileCommentHit, { detail: 1, clientX: 940, clientY: 110 })

  const nextComposer = screen.getByTestId('anchored-annotation-composer')
  expect(nextComposer.textContent).toContain('手机首页')
  expect(nextComposer.textContent).toContain('另有未发送的批注草稿')
  expect(
    (within(nextComposer).getByRole('textbox', { name: '批注内容' }) as HTMLTextAreaElement).value,
  ).toBe('')

  // 发送画板级批注（带点击坐标 rect）并校验 Esc 退出批注模式回选择工具。
  fireEvent.change(within(nextComposer).getByRole('textbox', { name: '批注内容' }), {
    target: { value: '手机画板留白再大一点' },
  })
  fireEvent.click(within(nextComposer).getByRole('button', { name: '发送' }))
  await waitFor(() => expect(submitted).toHaveLength(1))
  expect(submitted[0]).toMatchObject({
    kind: 'comment',
    audience: 'human',
    body: '手机画板留白再大一点',
    element: {
      boardId: 'mobile',
      blockId: 'mobile',
      rect: { x: 80, y: 120, width: 1, height: 1 },
    },
  })
  expect(screen.queryByTestId('pending-comment-pin')).toBeNull()

  fireEvent.keyDown(canvas, { key: 'Escape' })
  expect(canvas.dataset.tool).toBe('select')
})

it('画板级批注在沙盒无法匹配 DOM 时仍根据点击坐标渲染图钉，且仅查看角色禁用画布批注工具', () => {
  stubResizeObserver()
  const boardPin: Feedback = {
    id: 'fb-board-pin',
    artifactId: artifact.publicId,
    version: 1,
    roundId: null,
    groupId: null,
    kind: 'comment',
    audience: 'human',
    element: {
      boardId: 'desktop',
      blockId: 'desktop',
      rect: { x: 180, y: 220, width: 1, height: 1 },
    },
    body: '整板视觉节奏不错',
    author: 'human:local',
    draft: false,
    status: 'pending',
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ArtifactWorkspace
        detail={{
          ...detailFor(1, sourceWithCardAndText()),
          access: { role: 'view', expiresAt: '2099-01-01T00:00:00Z' },
        }}
        versions={[detailFor(1, sourceWithCardAndText()).version]}
        feedbacks={[boardPin]}
        sandboxOrigin="http://127.0.0.1:24331"
      />
    </QueryClientProvider>,
  )
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })
  // 模拟沙盒未能找到 blockId === 'desktop' 的 DOM 节点并回传 null。
  frame.receive({ type: 'pins.rects', rects: { 'fb-board-pin': null } })

  const pin = screen.getByTestId('annotation-pin-fb-board-pin')
  expect(pin.getAttribute('style')).toContain('translate3d(180px, 220px, 0)')

  // 仅查看访客不能进入画布批注落点模式。
  const commentBtn = screen.getByRole('button', { name: '画布批注' })
  expect(commentBtn.hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC' })
  expect(screen.getByRole('region', { name: '画布' }).dataset.tool).toBe('select')
})

it('选择工具支持直接拖拽移动和拉手柄缩放原生图层，且不显示重复选框', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor(1, sourceWithCardAndText()))
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const title = screen.getByRole('button', { name: '宽屏首页' })
  title.focus()
  fireEvent.keyDown(title, { key: 'Enter' })
  frame.receive({
    type: 'inspect.layers.snapshot',
    version: 1,
    truncated: false,
    layers: [
      {
        id: 'v1:card',
        tag: 'div',
        selector: 'aside > div:nth-of-type(1)',
        designId: 'card',
        label: '矩形',
        width: 160,
        height: 100,
      },
      {
        id: 'v1:heading',
        tag: 'div',
        selector: 'aside > div:nth-of-type(2)',
        designId: 'heading',
        label: '原始标题',
        width: 220,
        height: 44,
      },
    ],
  })
  frame.receive({
    type: 'inspect.select',
    reason: 'sync',
    version: 1,
    layerId: 'v1:card',
    element: {
      boardId: 'desktop',
      blockId: 'design-layer:card',
      selector: 'aside > div:nth-of-type(1)',
      rect: { x: 80, y: 90, width: 160, height: 100 },
    },
  })

  // 画板内旧选框已隐藏，只保留画布级选框和缩放手柄。
  expect(screen.getByTestId('overlay-select-box').className).toContain('opacity-0')
  const box = screen.getByTestId('canvas-layer-focus')
  expect(box.getAttribute('data-movable')).toBe('true')
  const seHandle = screen.getByTestId('canvas-layer-handle-se')

  // 直接拖拽移动图层：拖动期不发版、画布切 grabbing，松手发布一版。
  fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 145, clientY: 130 })
  expect(screen.getByRole('region', { name: '画布' }).dataset.dragging).toBe('true')
  expect(editor.current.version.version).toBe(1)
  fireEvent.pointerUp(box, { pointerId: 1, clientX: 145, clientY: 130 })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0]).toMatchObject({
    id: 'card',
    x: 125,
    y: 120,
    width: 160,
    height: 100,
  })

  // 拖右下角手柄缩放图层并显示实时尺寸徽标。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.pointerDown(seHandle, { button: 0, pointerId: 2, clientX: 200, clientY: 200 })
  fireEvent.pointerMove(seHandle, { pointerId: 2, clientX: 240, clientY: 225 })
  expect(screen.getByTestId('canvas-layer-dimensions').textContent).toBe('200 × 125')
  fireEvent.pointerUp(seHandle, { pointerId: 2, clientX: 240, clientY: 225 })
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0]).toMatchObject({
    id: 'card',
    width: 200,
    height: 125,
  })
})

it('添加文本在画布原地输入、点画布外部自动保存，并自动选中新建图层弹出选区浮栏与手柄', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())
  const canvas = screen.getByRole('region', { name: '画布' })

  fireEvent.click(screen.getByRole('button', { name: '添加文本' }))
  expect(canvas.dataset.tool).toBe('text')
  const surface = screen.getByRole('button', { name: '在宽屏首页添加文本' })
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))
  fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 120, clientY: 80 })
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: 120, clientY: 80 })

  // 原地编辑器直接挂载在画布内而非独立弹窗。
  const inlineEditor = within(canvas).getByTestId('canvas-inline-text-editor')
  const input = within(inlineEditor).getByRole('textbox', { name: '文字' })
  fireEvent.change(input, { target: { value: '画布原地标题' } })

  // 点击画布空白处自动提交保存。
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 10, clientY: 10 })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].designLayers[0]).toMatchObject({
    kind: 'text',
    text: '画布原地标题',
    x: 120,
    y: 80,
  })

  // 保存后自动选中新建文本图层，立刻可见选框手柄与选区工具栏。
  expect(screen.getByTestId('canvas-layer-focus')).toBeTruthy()
  expect(screen.getByTestId('canvas-layer-handle-se')).toBeTruthy()
  expect(screen.getByTestId('selection-toolbar')).toBeTruthy()
})

it('钢笔从空白画布起笔跨入画板后可连续落点并按 Enter 完成保存', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const editor = showEditableWorkspace(detailFor())

  fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' })
  expect(screen.getByRole('region', { name: '画布' }).dataset.tool).toBe('pen')

  const blank = screen.getByTestId('canvas-blank-drawing')
  vi.spyOn(blank, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 2400, 2100))
  const boardEl = screen
    .getByRole('button', { name: '宽屏首页' })
    .closest<HTMLElement>('.artifact-canvas-board')
  if (!boardEl) throw new Error('缺少宽屏画板容器')
  const boardLeft = Number.parseFloat(boardEl.style.left)
  const boardTop = Number.parseFloat(boardEl.style.top)
  const boardSurface = screen.getByRole('button', { name: '在宽屏首页绘制折线' })

  // 第一点落在画板左侧空白区，第二点跨入画板内部，按 Enter 一次完成跨板路径。
  fireEvent.pointerDown(blank, {
    button: 0,
    pointerId: 1,
    clientX: Math.max(2, boardLeft - 40),
    clientY: boardTop + 120,
  })
  fireEvent.pointerDown(boardSurface, {
    button: 0,
    pointerId: 1,
    clientX: boardLeft + 180,
    clientY: boardTop + 180,
  })
  fireEvent.keyDown(window, { key: 'Enter' })

  await waitFor(() => expect(editor.current.version.version).toBe(2))
  const [stroke] = JSON.parse(editor.current.version.source).boards[0].designLayers
  expect(stroke).toMatchObject({ kind: 'stroke' })
  expect(stroke.points).toHaveLength(2)
  expect(screen.getByTestId('canvas-layer-focus')).toBeTruthy()
})

it('选择与批注模式下指针滑过画板实时高亮元素，点击直接选中或预填批注目标', () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  showEditableWorkspace(detailFor())
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const hit = screen.getByRole('button', { name: '选择画板：宽屏首页' })
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))

  // 选择模式下经过画板元素即发送轻量 hover 命中并展示高亮框与标签。
  fireEvent.pointerMove(hit, { pointerType: 'mouse', buttons: 0, clientX: 160, clientY: 120 })
  const hoverRequest = frame.post.mock.calls.findLast(
    ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'hover',
  )?.[0]
  expect(hoverRequest).toMatchObject({ purpose: 'hover', version: 1, x: 160, y: 120 })
  const targetElement = {
    boardId: 'desktop',
    selector: 'main > h1:nth-of-type(1)',
    textPreview: '主标题',
    rect: { x: 120, y: 96, width: 240, height: 42 },
  }
  frame.receive({
    type: 'inspect.target',
    purpose: 'hover',
    requestId: hoverRequest.requestId,
    version: 1,
    element: targetElement,
  })
  const hoverBox = screen.getByTestId('canvas-layer-hover')
  expect(hoverBox.textContent).toContain('h1 · 主标题')

  // 即使尚未下发 layers 快照，点击该元素也立刻显示画布级选框且不再叠加重复 hover 框。
  fireEvent.click(hit, { detail: 1, clientX: 160, clientY: 120 })
  const selectRequest = frame.post.mock.calls.findLast(
    ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'select',
  )?.[0]
  frame.receive({
    type: 'inspect.target',
    purpose: 'select',
    requestId: selectRequest.requestId,
    version: 1,
    element: targetElement,
    layer: { id: 'v1:h1', selector: 'main > h1:nth-of-type(1)' },
  })
  expect(screen.getByTestId('canvas-layer-focus')).toBeTruthy()
  expect(screen.queryByTestId('canvas-layer-hover')).toBeNull()

  // 切到批注模式：滑过元素同样显示悬停高亮，点击立刻预填元素批注目标。
  fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC' })
  const commentHit = screen.getByRole('button', { name: '在宽屏首页添加批注' })
  vi.spyOn(commentHit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))
  fireEvent.pointerMove(commentHit, {
    pointerType: 'mouse',
    buttons: 0,
    clientX: 400,
    clientY: 220,
  })
  const commentHoverReq = frame.post.mock.calls.findLast(
    ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'hover',
  )?.[0]
  frame.receive({
    type: 'inspect.target',
    purpose: 'hover',
    requestId: commentHoverReq.requestId,
    version: 1,
    element: {
      boardId: 'desktop',
      selector: 'main > button:nth-of-type(1)',
      textPreview: '立即体验',
      rect: { x: 360, y: 200, width: 120, height: 40 },
    },
  })
  expect(screen.getByTestId('canvas-layer-hover').textContent).toContain('button · 立即体验')

  fireEvent.click(commentHit, { detail: 1, clientX: 400, clientY: 220 })
  const composer = screen.getByTestId('anchored-annotation-composer')
  expect(within(composer).getByText('元素批注')).toBeTruthy()
  expect(within(composer).getByText('宽屏首页 › button · 立即体验')).toBeTruthy()
})

it('patchHtmlElementGeometry 按源码行列累加位移、按边/角拉伸并保持行内标签可定位', () => {
  const html =
    '<section>\n  <span class="badge" style="color: rgb(15, 23, 42)">北堤</span>\n</section>'
  const moved = patchHtmlElementGeometry(html, '2:3', { translateDelta: { dx: 24, dy: -12 } })
  expect(moved).toContain('color: rgb(15, 23, 42); translate: 24px -12px; display: inline-block')

  const movedAgain = patchHtmlElementGeometry(moved, '2:3', {
    translateDelta: { dx: 6, dy: 12 },
    width: 180,
  })
  expect(movedAgain).toContain('translate: 30px 0px')
  expect(movedAgain).toContain('width: 180px; max-width: none; box-sizing: border-box')
  expect(movedAgain).not.toContain('height:')
})

it('静态 HTML 元素支持画布直接拖移、手柄拉伸与原地所见即所得修改文字', async () => {
  stubResizeObserver()
  vi.stubGlobal('PointerEvent', MouseEvent)
  const htmlSource = JSON.stringify({
    version: 1,
    boards: [
      {
        id: 'desktop',
        title: '宽屏首页',
        viewport: { width: 1440, height: 900 },
        html: '<main>\n  <h1 class="title">北堤，五点四十</h1>\n</main>',
      },
    ],
  })
  const editor = showEditableWorkspace(detailFor(1, htmlSource))
  const canvas = screen.getByRole('region', { name: '画布' })
  const frame = sandbox(screen.getByTitle('画板内容：宽屏首页'))
  frame.receive({ type: 'ready' })

  const hit = screen.getByRole('button', { name: '选择画板：宽屏首页' })
  vi.spyOn(hit, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1440, 900))
  fireEvent.click(hit, { detail: 1, clientX: 160, clientY: 110 })

  const selectReq = frame.post.mock.calls.findLast(
    ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'select',
  )?.[0]
  frame.receive({
    type: 'inspect.target',
    purpose: 'select',
    requestId: selectReq.requestId,
    version: 1,
    loc: '2:3',
    element: {
      boardId: 'desktop',
      selector: 'main > h1:nth-of-type(1)',
      textPreview: '北堤，五点四十',
      rect: { x: 100, y: 80, width: 160, height: 36 },
    },
    layer: { id: 'v1:h1', selector: 'main > h1:nth-of-type(1)' },
    presentation: {
      color: 'rgb(15, 23, 42)',
      backgroundColor: 'rgb(255, 255, 255)',
      fontSize: 16,
      fontWeight: 700,
      textAlign: 'left',
      isText: true,
    },
  })

  // 选中的 HTML 元素直接显示可拖移选框和八向缩放手柄。
  const box = screen.getByTestId('canvas-layer-focus')
  expect(box.getAttribute('data-movable')).toBe('true')
  const seHandle = screen.getByTestId('canvas-layer-handle-se')

  // 直接拖移 HTML 元素：松手写入 translate 样式并提交版本。
  fireEvent.pointerDown(box, { button: 0, pointerId: 1, clientX: 120, clientY: 100 })
  fireEvent.pointerMove(box, { pointerId: 1, clientX: 160, clientY: 130 })
  fireEvent.pointerUp(box, { pointerId: 1, clientX: 160, clientY: 130 })
  await waitFor(() => expect(editor.current.version.version).toBe(2))
  expect(JSON.parse(editor.current.version.source).boards[0].html).toContain(
    'style="translate: 40px 30px"',
  )

  // 拉右下角手柄拉伸 HTML 元素尺寸。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  fireEvent.pointerDown(seHandle, { button: 0, pointerId: 2, clientX: 260, clientY: 116 })
  fireEvent.pointerMove(seHandle, { pointerId: 2, clientX: 320, clientY: 156 })
  expect(screen.getByTestId('canvas-layer-dimensions').textContent).toBe('220 × 76')
  fireEvent.pointerUp(seHandle, { pointerId: 2, clientX: 320, clientY: 156 })
  await waitFor(() => expect(editor.current.version.version).toBe(3))
  const resizedHtml = JSON.parse(editor.current.version.source).boards[0].html
  expect(resizedHtml).toContain('width: 220px')
  expect(resizedHtml).toContain('height: 76px')

  // 双击 HTML 元素在画布原地打开所见即所得文字编辑器，不弹出遮挡底栏的大弹窗。
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '撤销画布编辑' }).hasAttribute('disabled')).toBe(
      false,
    ),
  )
  const originalFetch = globalThis.fetch
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/visual-edit/preview')) {
      const body = JSON.parse(String(init?.body ?? '{}'))
      const parsed = JSON.parse(editor.current.version.source)
      parsed.boards[0].html = parsed.boards[0].html.replace('北堤，五点四十', body.op.value)
      return new Response(JSON.stringify({ source: JSON.stringify(parsed) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/visual-edit')) {
      return new Response(
        JSON.stringify({
          target: { tagName: 'h1', text: '北堤，五点四十', className: 'title', order: null },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return originalFetch(input, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  try {
    fireEvent.doubleClick(box, { clientX: 160, clientY: 110 })
    const textReq = frame.post.mock.calls.findLast(
      ([msg]) => msg.type === 'inspect.at' && msg.purpose === 'text',
    )?.[0]
    frame.receive({
      type: 'inspect.target',
      purpose: 'text',
      requestId: textReq.requestId,
      version: 3,
      loc: '2:3',
      element: {
        boardId: 'desktop',
        selector: 'main > h1:nth-of-type(1)',
        textPreview: '北堤，五点四十',
        rect: { x: 140, y: 110, width: 220, height: 76 },
      },
      presentation: {
        color: 'rgb(15, 23, 42)',
        backgroundColor: 'rgb(255, 255, 255)',
        fontSize: 16,
        fontWeight: 700,
        textAlign: 'left',
        isText: true,
      },
    })
    const inlineEditor = await within(canvas).findByTestId('canvas-inline-text-editor')
    const input = within(inlineEditor).getByRole('textbox', { name: '文字' })
    fireEvent.change(input, { target: { value: '北堤，六点整' } })
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 3, clientX: 10, clientY: 10 })
    await waitFor(() => expect(editor.current.version.version).toBe(4))
    expect(JSON.parse(editor.current.version.source).boards[0].html).toContain('北堤，六点整')
  } finally {
    vi.stubGlobal('fetch', originalFetch)
  }
})
