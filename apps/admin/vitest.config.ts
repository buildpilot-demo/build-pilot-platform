import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // Convex function tests use convex-test, which mocks the Convex backend
    // and needs to run in an environment closer to Convex's own runtime; see
    // the `@vitest-environment edge-runtime` docblock in convex/*.test.ts.
    server: { deps: { inline: ['convex-test'] } },
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
