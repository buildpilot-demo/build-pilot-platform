import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";

export type AuthCtx = { auth: Auth };

/**
 * The only supported auth-gate for admin-facing Convex functions (T7.4,
 * Section 12: "All admin mutations/queries require server-side
 * authentication + authorization"). Backed by Convex Auth — there is no
 * unauthenticated bypass; every admin query/mutation/action must call this
 * (or be an internalQuery/internalMutation/internalAction, which raw API
 * clients can never reach at all).
 */
export async function requireAdmin(ctx: AuthCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Authenticated admin access required");
  return userId;
}
