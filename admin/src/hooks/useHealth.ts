import { useQuery } from "convex/react";
import { adminApi } from "../lib/api";

/**
 * Example Convex query hook, following the pattern later stages should use
 * for new screens: wrap `useQuery(adminApi.<fn>, args)` in a small,
 * named hook so pages consume data through `src/hooks` instead of calling
 * `convex/react` directly.
 *
 * Existing pages (e.g. HealthPage) predate this convention and still call
 * `useQuery` inline — left as-is here, this hook is scaffolding only.
 */
export function useHealth() {
  return useQuery(adminApi.health, {});
}
