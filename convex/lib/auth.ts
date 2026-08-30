import type { Auth } from "convex/server";

export type AuthCtx = { auth: Auth };

/**
 * Authentication has been removed for this console — every user has full
 * admin access with no sign-in required. This function is kept as a no-op
 * so existing call sites don't need to change if auth is reintroduced later.
 */
export async function requireAdmin(_ctx: AuthCtx): Promise<null> {
  return null;
}
