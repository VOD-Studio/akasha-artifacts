import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) },
    conditions: ['@akasha/source', 'import', 'module', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['@akasha/source', 'node', 'default'],
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/*/test/**/*.test.{ts,tsx}'],
  },
})
