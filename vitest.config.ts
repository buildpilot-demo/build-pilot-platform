import { defineConfig } from "vitest/config";

// The admin/ app has its own independent Vitest setup (jsdom, RTL) and test
// script (admin/package.json). Exclude it here so the root `npm test` only
// covers the Convex backend.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "admin/**"],
  },
});
