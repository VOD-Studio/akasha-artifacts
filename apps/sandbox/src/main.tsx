import '@tailwindcss/browser'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SandboxApp } from './App'
import { parseSandboxHash, SandboxBridgeClient } from './bridge/client'
import { installSandboxGlobals } from './runtime/modules'
import { installSandboxStorage } from './runtime/storage'

installSandboxGlobals()

// hash 里没有外壳参数时不建 Bridge，沙盒可独立打开
const params = parseSandboxHash(window.location.hash)
const bridge = params
  ? new SandboxBridgeClient({
      expectedOrigin: params.origin,
      nonce: params.nonce,
    })
  : null
installSandboxStorage(bridge)

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <SandboxApp bridge={bridge} />
    </StrictMode>,
  )
}
