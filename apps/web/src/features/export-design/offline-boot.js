const boot = document.currentScript
function bootFailed(message) {
  const root = document.getElementById('root')
  root.lang = offlineText.lang
  root.textContent = message
  parent.postMessage({ type: 'akasha.offline.error', message }, '*')
}

void (async () => {
  try {
    const encoded = document.getElementById('akasha-offline-runtime').textContent
    const bytes = Uint8Array.from(atob(encoded), (byte) => byte.charCodeAt(0))
    const { script, style } = await new Response(
      new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).json()
    const css = document.createElement('style')
    css.textContent = style
    document.head.append(css)
    const runtime = document.createElement('script')
    runtime.nonce = boot.nonce
    runtime.textContent = script
    const crash = (event) => bootFailed(event.message || offlineText.startup)
    window.addEventListener('error', crash)
    try {
      document.body.append(runtime)
    } finally {
      window.removeEventListener('error', crash)
    }
  } catch {
    bootFailed(offlineText.unpack)
  }
})()
