import { resolveArtboardTweaks } from '@akasha/protocol'
import { tsxLanguage } from '@codemirror/lang-javascript'
import { strToU8, zipSync } from 'fflate'
import type { LoadedCanvasBoard } from '@/entities/artifact'
import { getMessages, type Locale } from '@/shared/i18n'
import { messages } from './messages'
import boot from './offline-boot.js?raw'
import player from './offline-player.js?raw'
import { offlinePage } from './offline-preview'

type OfflineOutput = 'design-html' | 'design-zip' | 'board-zip'

interface OfflineDesign {
  title: string
  version: number
  pages: readonly { id: string; title: string; boardIds: readonly string[] }[]
  boards: readonly LoadedCanvasBoard[]
  flows: readonly { from: string; to: string; label?: string }[]
}

function inertJson(value: unknown) {
  return JSON.stringify(value).replaceAll('<', '\\u003c')
}

function embedded(url: string) {
  return !url || /^(?:data:|#)/i.test(url)
}

function inspectStyles(css: string) {
  if (/@import\b/i.test(css))
    throw new Error(getMessages(messages).t('离线包不能加载 CSS @import，请内联样式和资源'))
  for (const match of css.matchAll(/\burl\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const url = match[2]?.trim() ?? ''
    if (!embedded(url))
      throw new Error(
        getMessages(messages).t('不能离线打包样式资源：{url}', { url: url.slice(0, 180) }),
      )
  }
}

function inspectHtml(source: string) {
  // template 的内容始终惰性；在校验前不请求作者提供的地址。
  const content = document.createElement('template')
  content.innerHTML = source
  for (const element of content.content.querySelectorAll('*')) {
    for (const name of ['src', 'poster', 'background']) {
      const url = element.getAttribute(name)?.trim()
      if (url && !embedded(url))
        throw new Error(
          getMessages(messages).t('不能离线打包资源：{url}', { url: url.slice(0, 180) }),
        )
    }
    if (element.hasAttribute('srcset'))
      throw new Error(getMessages(messages).t('离线包不接受 srcset，请改用单个内嵌的 data: 图片'))
    if (
      element.matches('script, iframe, object, embed, link, base') ||
      Array.from(element.attributes).some(({ name }) => name.startsWith('on'))
    )
      throw new Error(
        getMessages(messages).t(
          'HTML 离线包不支持外部嵌入或脚本；交互请使用表单、声明的流程或 React',
        ),
      )
    if (element.matches('image, use')) {
      const url = (element.getAttribute('href') ?? element.getAttribute('xlink:href'))?.trim()
      if (url && !embedded(url))
        throw new Error(
          getMessages(messages).t('不能离线打包 SVG 资源：{url}', { url: url.slice(0, 180) }),
        )
    }
    const css =
      element.getAttribute('style') ?? (element.matches('style') ? element.textContent : '')
    if (css) inspectStyles(css)
  }
}

function inspectReact(source: string) {
  // 静态检测条件分支中的资源字面量；表达式的实际结果由隔离沙盒预检。
  tsxLanguage.parser.parse(source).iterate({
    enter({ name, node, from, to }) {
      if (
        name === 'MemberExpression' &&
        /^(?:window\.)?akasha\s*(?:\?\.|\.)\s*storage$/.test(source.slice(from, to))
      )
        throw new Error(
          getMessages(messages).t('依赖运行存储的交互不能离线打包，请改用内置初始数据'),
        )
      if (name !== 'JSXAttribute') return
      const attribute = node.getChild('JSXIdentifier')
      const tag = node.parent?.getChild('JSXBuiltin')?.getChild('JSXIdentifier')
      if (!attribute || !tag) return
      const key = source.slice(attribute.from, attribute.to)
      const element = source.slice(tag.from, tag.to)
      const isResource =
        (key === 'src' &&
          /^(?:img|audio|video|source|track|input|iframe|script|embed)$/.test(element)) ||
        (key === 'poster' && element === 'video') ||
        (key === 'href' && /^(?:image|use|link)$/.test(element))
      if (!isResource) return
      const expression = node.getChild('JSXEscape')
      const literal =
        node.getChild('JSXAttributeValue') ??
        expression?.getChild('String') ??
        expression?.getChild('TemplateString')
      if (!literal) return
      const url = source.slice(literal.from + 1, literal.to - 1).trim()
      if (!url.includes('${') && !url.includes('\\') && !embedded(url))
        throw new Error(
          getMessages(messages).t('不能离线打包资源：{url}', { url: url.slice(0, 180) }),
        )
    },
  })
}

function inspectBoard(board: LoadedCanvasBoard) {
  if (board.type === 'html' || board.type === 'svg') inspectHtml(board.source)
  if (board.type === 'react') inspectReact(board.source)
}

function frameParts(runtime: string, locale: Locale) {
  const { t } = getMessages(messages, locale)
  const text = inertJson({
    lang: locale,
    failed: t('无法打开离线预览'),
    decode: t('有图片无法离线加载'),
    missing: t('离线画板数据缺失'),
    unsupported: t('此作品无法离线打开'),
    resource: t('不能离线载入资源：{location}'),
    startup: t('离线运行器启动失败'),
    unpack: t('浏览器无法解压离线运行器'),
  })
  const nonce = crypto.randomUUID()
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' blob: 'wasm-unsafe-eval'`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data: blob:',
    'media-src data: blob:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    frameStart: `<!doctype html><html dir="ltr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"></head><body><div id="root"></div><script type="application/json" id="akasha-offline-board">`,
    frameEnd: `</script><script type="text/plain" id="akasha-offline-runtime">${runtime}</script><script nonce="${nonce}">const offlineText=${text};\n${boot}</script></body></html>`,
  }
}

function preflight(html: string, width: number, height: number, signal: AbortSignal) {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.width = String(width)
  frame.height = String(height)
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none'
  frame.srcdoc = html
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(16_000)])
  return new Promise<void>((resolve, reject) => {
    function finish(error?: unknown) {
      window.removeEventListener('message', receive)
      deadline.removeEventListener('abort', abort)
      frame.remove()
      if (error) reject(error)
      else resolve()
    }
    function abort() {
      finish(
        signal.aborted ? signal.reason : new Error(getMessages(messages).t('画板无法离线打开')),
      )
    }
    function receive({ source, origin, data }: MessageEvent) {
      if (origin !== 'null' || source !== frame.contentWindow) return
      if (data?.type === 'akasha.offline.ready') finish()
      if (data?.type === 'akasha.offline.error')
        finish(new Error(String(data.message).slice(0, 600)))
    }
    if (deadline.aborted) return abort()
    window.addEventListener('message', receive)
    deadline.addEventListener('abort', abort, { once: true })
    document.body.append(frame)
  })
}

function boardError(
  board: LoadedCanvasBoard,
  design: OfflineDesign,
  output: OfflineOutput,
  error: unknown,
) {
  const { t } = getMessages(messages)
  const page =
    output === 'design-zip' && design.pages.find((page) => page.boardIds.includes(board.id))
  const title = page && page.id ? `${page.title} / ${board.title}` : board.title
  return new Error(
    t('「{title}」：{error}', {
      title,
      error: error instanceof Error ? error.message : t('无法离线渲染'),
    }),
  )
}

/** 以离线同款隔离环境逐张预检；任何画板失败时都不产出部分交付物。 */
export async function composeOfflineDesign(
  design: OfflineDesign,
  output: OfflineOutput,
  signal: AbortSignal,
  onProgress: (current: number, total: number, title: string) => void,
): Promise<Blob> {
  const { t, locale } = getMessages(messages)
  signal.throwIfAborted()
  if (!design.boards.length) throw new Error(t('指定版本没有可导出的画板'))
  if (output === 'board-zip' && design.boards.length !== 1)
    throw new Error(t('单板 ZIP 只能包含一张画板'))
  for (const board of design.boards) {
    signal.throwIfAborted()
    try {
      inspectBoard(board)
    } catch (error) {
      throw boardError(board, design, output, error)
    }
  }
  const response = await fetch('/assets/akasha-offline.bundle.txt', { signal, credentials: 'omit' })
  const runtime = response.ok ? await response.text() : ''
  if (!/^H4sI[A-Za-z0-9+/]+={0,2}$/.test(runtime))
    throw new Error(
      getMessages(messages).t('缺少离线运行资产，请检查实例是否完整构建（make build）'),
    )
  const frames = frameParts(runtime, locale)
  // 只交付固定快照的渲染输入。调用方即使带上工作区状态，也不会被序列化。
  const boards = design.boards.map((board) => ({
    id: board.id,
    title: board.title,
    legacyId: board.legacyBlockId,
    boardId: board.scoped ? board.id : undefined,
    type: board.type,
    width: board.width,
    height: board.height,
    source: board.source,
    version: design.version,
    designLayers: board.designLayers,
    boardAppearance: board.appearance,
    boardTweaks: board.tweaks?.length ? resolveArtboardTweaks(board.tweaks) : undefined,
  }))
  for (const [index, board] of boards.entries()) {
    signal.throwIfAborted()
    onProgress(index + 1, boards.length, board.title)
    try {
      await preflight(
        frames.frameStart + inertJson(board) + frames.frameEnd,
        board.width,
        board.height,
        signal,
      )
    } catch (error) {
      signal.throwIfAborted()
      throw boardError(design.boards[index], design, output, error)
    }
  }
  signal.throwIfAborted()
  const ids = new Set(boards.map(({ id }) => id))
  const data = inertJson({
    title: design.title,
    version: design.version,
    pages:
      output === 'board-zip'
        ? []
        : design.pages.map(({ id, title, boardIds }) => ({ id, title, boardIds })),
    boards,
    flows: design.flows
      .filter(({ from, to }) => ids.has(from) && ids.has(to))
      .map(({ from, to, label }) => ({ from, to, label })),
  })
  // 经典脚本可随 index.html 从 file:// 读取，不依赖 ES 模块、相对 fetch 或本地服务。
  const framesScript = `const offlineFrames = ${inertJson(frames)};`
  const html = offlinePage(data, output === 'design-zip' ? undefined : framesScript, locale)
  if (output === 'design-html') return new Blob([html], { type: 'text/html;charset=utf-8' })
  const files: Record<string, Uint8Array> = { 'index.html': strToU8(html) }
  if (output === 'design-zip') {
    files['assets/runtime.js'] = strToU8(framesScript)
    files['assets/player.js'] = strToU8(player)
  }
  return new Blob([zipSync(files)], { type: 'application/zip' })
}
