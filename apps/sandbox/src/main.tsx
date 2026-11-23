import '@tailwindcss/browser'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SandboxApp } from './App'
import { parseSandboxHash, SandboxBridgeClient } from './bridge/client'
import { installSandboxGlobals } from './runtime/modules'
import { installSandboxStorage } from './runtime/storage'

installSandboxGlobals()

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
