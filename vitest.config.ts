import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['@akasha/source', 'import', 'module', 'default'],
  },
  ssr: {
    resolve: {
      conditions: ['@akasha/source', 'import', 'module', 'node', 'default'],
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/*/test/**/*.test.{ts,tsx}'],
  },
})
