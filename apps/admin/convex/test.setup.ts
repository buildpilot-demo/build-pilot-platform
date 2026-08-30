/// <reference types="vite/client" />

// All Convex function modules, for convex-test to register into its mock
// backend. `_generated/` must be included (convex-test uses it to resolve
// the project root); only test files themselves are excluded.
export const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])
