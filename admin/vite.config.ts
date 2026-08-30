import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// The Convex backend lives in a sibling `convex/` directory at the repo
// root (this package lives in `admin/`), so the frontend needs an alias
// to reach its generated API client. Requires `npx convex dev` to have
// been run at least once from the repo root (convex/_generated is
// gitignored there, not committed) -- see this app's README.md.
const convexDir = path.resolve(dirname, '../convex')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@convex': convexDir,
    },
  },
})
