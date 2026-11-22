import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:24321',
        changeOrigin: true,
        ws: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:24321',
        changeOrigin: true,
      },
    },
  },
})
