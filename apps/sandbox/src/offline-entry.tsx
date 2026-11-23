import './runtime/no-jit'
import '@tailwindcss/browser'
import './styles.css'
import type { ArtifactType, DesignLayer } from '@akasha/protocol'
import { createRoot } from 'react-dom/client'
import { bindPrototype } from './prototype'
import { registerBuiltinRenderers } from './renderers/builtins'
import { DesignLayerScene } from './renderers/DesignLayerScene'
import { getRenderer } from './renderers/registry'
import { installSandboxGlobals } from './runtime/modules'
import { installSandboxStorage } from './runtime/storage'
import { defaultPreservedStateManager } from './state/preserve'
import { defaultArtifactStateStore } from './state/store'

interface OfflineRender {
  type: ArtifactType
  version: number
  source: string
  boardId?: string
  designLayers?: DesignLayer[]
}

function notify(type: string, data?: { target?: string; message?: string }) {
  parent.postMessage({ type: `akasha.offline.${type}`, ...data }, '*')
}

const rootElement = document.getElementById('root')
let failure: string | undefined
function failed(message: string) {
  if (failure) return
  failure = message.slice(0, 600) || '离线预览不能启动'
  if (rootElement?.parentElement) {
    const notice = document.createElement('p')
    notice.setAttribute('role', 'alert')
    notice.textContent = failure
    rootElement.before(notice)
  }
  notify('error', { message: failure })
}

let reported = false
async function rendered() {
  if (reported || failure) return
  reported = true
  // 内嵌图片解码失败时不报告成功；异步运行错误也会继续发给父页。
  try {
    if (rootElement) {
      const images = [...rootElement.querySelectorAll('img')].filter((img) => img.src)
      for (const image of images) image.loading = 'eager'
      await Promise.all(images.map((image) => image.decode()))
    }
    await document.fonts.ready
    await new Promise((resolve) => window.setTimeout(resolve, 30))
    if (!failure) notify('ready')
  } catch {
    failed('离线画板有无法解码的图片资源')
  }
}

try {
  if (!rootElement) throw new Error('离线运行容器缺失')
  const input = document.getElementById('akasha-offline-board')?.textContent
  if (!input) throw new Error('离线画板数据缺失')
  const payload = JSON.parse(input) as OfflineRender
  installSandboxGlobals()
  installSandboxStorage(null)
  registerBuiltinRenderers()
  const render = getRenderer(payload.type)
  if (!render) throw new Error('该制品类型不能离线渲染')

  window.addEventListener('securitypolicyviolation', (event) => {
    const location =
      event.blockedURI === 'eval' ? `（${event.lineNumber}:${event.columnNumber}）` : ''
    failed(`不能离线载入资源：${event.blockedURI || event.violatedDirective}${location}`)
  })
  window.addEventListener('error', (event) => failed(event.message || '离线资源加载失败'), true)
  window.addEventListener('unhandledrejection', (event) => {
    failed(event.reason instanceof Error ? event.reason.message : String(event.reason))
  })
  bindPrototype(rootElement, {
    navigate: (target) => notify('navigate', { target }),
    exit: () => notify('exit'),
  })
  createRoot(rootElement).render(
    <div className="relative min-h-screen bg-white text-slate-900">
      {payload.designLayers?.length ? (
        <DesignLayerScene layers={payload.designLayers} interactive={false} />
      ) : null}
      {render({
        source: payload.source,
        boardId: payload.boardId,
        version: payload.version,
        stateStore: defaultArtifactStateStore,
        preserved: defaultPreservedStateManager,
        onError: ({ message }) => failed(message),
        onRendered: rendered,
      })}
    </div>,
  )
} catch (error) {
  failed(error instanceof Error ? error.message : '离线预览不能启动')
}
