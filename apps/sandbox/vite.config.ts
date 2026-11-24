import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { devHost, devSandboxPort, devWorkbenchOrigin } from '../../scripts/dev-endpoints.js'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ['@akasha/source', 'browser', 'import', 'module', 'default'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: devHost,
    port: devSandboxPort,
    strictPort: true,
    // allow-scripts iframe 的模块请求携带不透明 Origin；CSP 只放行本沙盒的 HMR。
    cors: { origin: 'null' },
    headers: {
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'self' 'unsafe-inline' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        'media-src data: blob:',
        "font-src 'self' data:",
        `connect-src ws://${devHost}:${devSandboxPort}`,
        `frame-ancestors ${devWorkbenchOrigin}`,
      ].join('; '),
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  },
})
