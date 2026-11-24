import type { ClientRequest, IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import {
  devDaemonOrigin,
  devHost,
  devPublicDir,
  devSandboxOrigin,
  devWorkbenchOrigin,
  devWorkbenchPort,
} from '../../scripts/dev-endpoints.js'

function forwardWorkbenchOrigin(outgoing: ClientRequest, incoming: IncomingMessage) {
  // 只翻译开发工作台的同源请求；沙盒和其他站点的 Origin 仍由 Daemon 拒绝。
  if (incoming.headers.origin === devWorkbenchOrigin) {
    outgoing.setHeader('origin', devDaemonOrigin)
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'akasha-dev-sandbox-origin',
      apply: 'serve',
      config: () => ({ publicDir: fileURLToPath(devPublicDir) }),
      transformIndexHtml: () => [
        {
          tag: 'script',
          injectTo: 'head-prepend',
          children: `window.__AKASHA_CONFIG__=${JSON.stringify({ sandboxOrigin: devSandboxOrigin })}`,
        },
      ],
    },
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    conditions: ['@akasha/source', 'browser', 'import', 'module', 'default'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: devHost,
    port: devWorkbenchPort,
    strictPort: true,
    proxy: {
      '^/(?:api|auth)/': {
        target: devDaemonOrigin,
        changeOrigin: true,
        ws: true,
        configure(proxy) {
          proxy.on('proxyReq', forwardWorkbenchOrigin)
          proxy.on('proxyReqWs', forwardWorkbenchOrigin)
        },
      },
    },
  },
})
