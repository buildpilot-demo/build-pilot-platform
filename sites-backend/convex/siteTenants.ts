import { mutationGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

// Public provisioning endpoint, called cross-deployment — via
// ConvexHttpClient, not ctx.runMutation — from build-pilot-platform's own
// control-plane deployment (convex/deployments.ts::deployToFirebase), since
// that action runs on a *different* Convex project and can't reach an
// internal mutation here directly. Public (not internalMutationGeneric) for
// that reason, so it's guarded by SITE_TENANT_PROVISION_TOKEN (set on both
// deployments) instead of being open to any caller.
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export const provisionTenant = mutationGeneric({
  args: {
    token: v.string(),
    projectId: v.string(),
    siteId: v.string(),
    firebaseProjectId: v.string(),
    firebaseSiteId: v.string(),
    convexUrl: v.string(),
    backendVersion: v.string(),
  },
  handler: async (ctx, args) => {
    if (!constantTimeEqual(args.token, required("SITE_TENANT_PROVISION_TOKEN"))) {
      throw new ConvexError("Invalid provisioning token");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("siteTenants")
      .withIndex("by_site_id", (query) => query.eq("siteId", args.siteId))
      .first();
    const fields = {
      projectId: args.projectId,
      firebaseProjectId: args.firebaseProjectId,
      firebaseSiteId: args.firebaseSiteId,
      convexUrl: args.convexUrl,
      backendVersion: args.backendVersion,
      status: "active" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch("siteTenants", existing._id, fields);
      return { id: existing._id };
    }
    const id = await ctx.db.insert("siteTenants", { ...fields, siteId: args.siteId, createdAt: now });
    return { id };
  },
});
