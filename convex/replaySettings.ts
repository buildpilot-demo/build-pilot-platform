import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

// NOTE: Admin authentication is intentionally disabled for now; any user can
// access these mutations/queries. Authentication will be added back in a future pass.

const modeValidator = v.union(v.literal("live"), v.literal("replay"));

export const setProjectReplayMode = mutationGeneric({
  args: {
    projectId: v.id("projects"),
    mode: modeValidator,
    stages: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (!project) throw new Error(`Project ${args.projectId} not found`);
    const stages = [...new Set((args.stages ?? []).map((stage) => stage.trim()).filter(Boolean))];
    await ctx.db.patch("projects", args.projectId, {
      externalCallMode: args.mode,
      externalCallReplayStages: stages,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setGlobalReplayMode = mutationGeneric({
  args: { mode: modeValidator },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("externalCallSettings")
      .withIndex("by_scope", (query) => query.eq("scope", "global"))
      .first();
    const value = { scope: "global", mode: args.mode, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch("externalCallSettings", existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("externalCallSettings", value);
  },
});

export const getReplaySettings = queryGeneric({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, args) => {
    const [project, global] = await Promise.all([
      args.projectId ? ctx.db.get("projects", args.projectId) : Promise.resolve(null),
      ctx.db
        .query("externalCallSettings")
        .withIndex("by_scope", (query) => query.eq("scope", "global"))
        .first(),
    ]);
    return {
      globalMode: global?.mode ?? "live",
      projectMode: project?.externalCallMode ?? "live",
      stages: project?.externalCallReplayStages ?? [],
    };
  },
});
