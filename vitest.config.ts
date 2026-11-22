import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['@akasha/source'],
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'apps/*/test/**/*.test.{ts,tsx}'],
  },
})
