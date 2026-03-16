import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 35_000,
    hookTimeout: 30_000,
  },
})
