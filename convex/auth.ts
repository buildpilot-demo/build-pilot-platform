import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

// Single-operator admin console: email+password only, no external portal
// (per Section 12 / T7.4 — "Convex's built-in auth may need no separate
// portal at all"). There is no public sign-up UI; the one admin account is
// created via the one-time bootstrap in convex/lib/bootstrapAdmin.ts.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
