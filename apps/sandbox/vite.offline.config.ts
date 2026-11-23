import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // 库模式保留 Node 的环境引用；离线经典脚本没有 process。
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), tailwindcss()],
  resolve: { conditions: ['@akasha/source', 'browser', 'import', 'module', 'default'] },
  build: {
    outDir: 'dist/offline',
    emptyOutDir: true,
    lib: {
      entry: 'src/offline-entry.tsx',
      name: 'AkashaOffline',
      formats: ['iife'],
      fileName: () => 'akasha-offline.js',
      cssFileName: 'akasha-offline',
    },
  },
})
