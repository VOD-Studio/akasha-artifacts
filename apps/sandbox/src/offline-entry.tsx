import './runtime/no-jit'
import '@tailwindcss/browser'
import './styles.css'
import type {
  ArtboardAppearance,
  ArtboardTweakValues,
  ArtifactType,
  DesignLayer,
} from '@akasha/protocol'
import { createRoot } from 'react-dom/client'
import { bindPrototype } from './prototype/binding'
import { registerBuiltinRenderers } from './renderers/builtins'
import { getRenderer } from './renderers/registry'
import { artboardStyle } from './renderers/templates/artboard-style'
import { DesignLayerScene } from './renderers/templates/DesignLayerScene'
import { installSandboxGlobals } from './runtime/modules'
import { installSandboxStorage } from './runtime/storage'
import { defaultPreservedStateManager } from './state/preserve'
import { defaultArtifactStateStore } from './state/store'

// 与当前运行器同包的启动脚本提供文案；不从作者内容或浏览器默认语言推断。
declare const offlineText: Readonly<
  Record<'lang' | 'failed' | 'decode' | 'missing' | 'unsupported' | 'resource' | 'startup', string>
>

interface OfflineRender {
  type: ArtifactType
  version: number
  source: string
  boardId?: string
  designLayers?: DesignLayer[]
  boardAppearance?: ArtboardAppearance
  boardTweaks?: ArtboardTweakValues
}

function notify(type: string, data?: { target?: string; message?: string }) {
  parent.postMessage({ type: `akasha.offline.${type}`, ...data }, '*')
}

const rootElement = document.getElementById('root')
let failure: string | undefined
function failed(message: string) {
  if (failure) return
  failure = message.slice(0, 600) || offlineText.failed
  if (rootElement?.parentElement) {
    const notice = document.createElement('p')
    notice.setAttribute('role', 'alert')
    notice.lang = offlineText.lang
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
    failed(offlineText.decode)
  }
}

try {
  if (!rootElement) throw new Error(offlineText.startup)
  const input = document.getElementById('akasha-offline-board')?.textContent
  if (!input) throw new Error(offlineText.missing)
  const payload = JSON.parse(input) as OfflineRender
  installSandboxGlobals()
  installSandboxStorage(null)
  registerBuiltinRenderers()
  const render = getRenderer(payload.type)
  if (!render) throw new Error(offlineText.unsupported)

  window.addEventListener('securitypolicyviolation', (event) => {
    const location =
      event.blockedURI === 'eval' ? `（${event.lineNumber}:${event.columnNumber}）` : ''
    failed(
      offlineText.resource.replace(
        '{location}',
        () => `${event.blockedURI || event.violatedDirective}${location}`,
      ),
    )
  })
  window.addEventListener('error', (event) => failed(event.message || offlineText.failed), true)
  window.addEventListener('unhandledrejection', (event) => {
    failed(event.reason instanceof Error ? event.reason.message : String(event.reason))
  })
  bindPrototype(rootElement, {
    navigate: (target) => notify('navigate', { target }),
    exit: () => notify('exit'),
  })
  createRoot(rootElement).render(
    <div
      className="relative min-h-screen bg-white text-slate-900"
      style={artboardStyle(payload.boardAppearance, payload.boardTweaks)}
    >
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
  failed(error instanceof Error ? error.message : offlineText.startup)
}
