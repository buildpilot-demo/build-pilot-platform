import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { createAccount } from "@convex-dev/auth/server";

/**
 * One-time setup: creates the single admin account for this console.
 *
 * Deliberately an internalAction — reachable only via `npx convex run`
 * (or the Convex dashboard's function runner), both of which require
 * project/deploy-key access. It is never part of the public API surface,
 * so there is no public sign-up form anywhere a browser could reach (T7.4).
 * There is intentionally no equivalent public "sign up" mutation/action.
 *
 * Usage, once, after deploying:
 *   npx convex run lib/bootstrapAdmin:createAdminAccount \
 *     '{"email":"you@example.com","password":"a-strong-password"}'
 */
export const createAdminAccount = internalActionGeneric({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email) throw new Error("Email is required");
    if (args.password.length < 8) throw new Error("Password must be at least 8 characters");
    const result = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: args.password },
      profile: { email },
    });
    return { userId: result.user._id };
  },
});
